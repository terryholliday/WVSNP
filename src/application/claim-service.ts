import { Pool, PoolClient } from 'pg';
import * as crypto from 'crypto';
import { EventStore, DomainEvent } from '../event-store';
import { IdempotencyService } from './idempotency-service';
import { ClaimId, ClaimFingerprint, VoucherId, MoneyCents, Claim, ActorId } from '../domain-types';
import { applyClaimEvent, ClaimState, checkClaimInvariant, createInitialClaimState, validateClaimSubmission, DecisionBasis } from '../domain/claim/claim-logic';
import { applyClinicEvent, ClinicState, checkClinicInvariant, createInitialClinicState, canClinicSubmitClaim } from '../domain/clinic/clinic-logic';

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class ClaimService {
  constructor(private pool: Pool, private store: EventStore, private idempotency: IdempotencyService) {}

  async submitClaim(request: {
    idempotencyKey: string;
    grantCycleId: string;
    claimId?: ClaimId;
    voucherId: VoucherId;
    clinicId: string;
    procedureCode: string;
    dateOfService: Date;
    submittedAmountCents: MoneyCents;
    artifacts: {
      procedureReportId: string;
      clinicInvoiceId: string;
      rabiesCertificateId?: string;
      coPayReceiptId?: string;
      additionalIds?: string[];
    };
    rabiesIncluded?: boolean;
    coPayCollectedCents?: MoneyCents;
    actorId: string;
    actorType: 'APPLICANT' | 'ADMIN' | 'SYSTEM';
    correlationId: string;
    causationId?: string;
  }): Promise<{ claimId: ClaimId }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const status = await this.idempotency.checkAndReserve(client, request.idempotencyKey, 'SUBMIT_CLAIM', 'hash', 86400);
      if (status === 'COMPLETED') {
        const result = await client.query('SELECT response_json FROM idempotency_cache WHERE idempotency_key = $1', [request.idempotencyKey]);
        return result.rows[0].response_json;
      }
      if (status === 'PROCESSING') {
        throw new Error('OPERATION_IN_PROGRESS');
      }

      // FIX 6: Hard artifact enforcement (LAW 7.5)
      if (!request.artifacts.procedureReportId) {
        throw new Error('MISSING_REQUIRED_ARTIFACTS: procedureReportId');
      }
      if (!request.artifacts.clinicInvoiceId) {
        throw new Error('MISSING_REQUIRED_ARTIFACTS: clinicInvoiceId');
      }
      if (request.rabiesIncluded && !request.artifacts.rabiesCertificateId) {
        throw new Error('MISSING_REQUIRED_ARTIFACTS: rabiesCertificateId');
      }
      if (request.coPayCollectedCents && request.coPayCollectedCents > 0n && !request.artifacts.coPayReceiptId) {
        throw new Error('MISSING_REQUIRED_ARTIFACTS: coPayReceiptId');
      }

      // FIX 8: ClaimId must be UUIDv4 (client-generated or server fallback)
      const claimId = (request.claimId ?? crypto.randomUUID()) as ClaimId;
      if (!UUID_V4_REGEX.test(claimId)) {
        throw new Error('CLAIM_ID_INVALID');
      }

      // Phase 4: Check if claims deadline has passed (deadline enforcement)
      const claimsDeadlinePassed = await client.query(
        `SELECT COUNT(*) as count FROM event_log 
         WHERE event_type = 'GRANT_CLAIMS_DEADLINE_PASSED' AND grant_cycle_id = $1`,
        [request.grantCycleId]
      );
      if (parseInt(claimsDeadlinePassed.rows[0].count) > 0) {
        throw new Error('GRANT_CLAIMS_DEADLINE_PASSED');
      }

      // Phase 4: Check if cycle is closed (closeout lock)
      const cycleClosed = await client.query(
        `SELECT COUNT(*) as count FROM event_log 
         WHERE event_type = 'GRANT_CYCLE_CLOSED' AND grant_cycle_id = $1`,
        [request.grantCycleId]
      );
      if (parseInt(cycleClosed.rows[0].count) > 0) {
        throw new Error('GRANT_CYCLE_CLOSED');
      }

      // HAZARD 1: Use canonicalized fingerprint with all inputs
      const claimFingerprint = Claim.createFingerprint(
        request.voucherId,
        request.clinicId,
        request.procedureCode,
        request.dateOfService.toISOString().split('T')[0],
        request.rabiesIncluded || false
      );

      // HAZARD 2 FIX: Check for existing claim via fingerprint and return existing claimId
      // This handles retries and flaky networks gracefully (no throw on duplicate)
      const existingClaim = await client.query(
        'SELECT claim_id FROM claims_projection WHERE claim_fingerprint = $1 AND grant_cycle_id = $2',
        [claimFingerprint, request.grantCycleId]
      );
      
      if (existingClaim.rows.length > 0) {
        const existingClaimId = existingClaim.rows[0].claim_id as ClaimId;
        const response = { claimId: existingClaimId, status: 'DUPLICATE_DETECTED' as const };
        await this.idempotency.recordResult(client, request.idempotencyKey, response);
        await client.query('COMMIT');
        return response;
      }

      // FIX 5: Time-scoped license validation (LAW 7.1)
      const clinicRow = await client.query('SELECT * FROM vet_clinics_projection WHERE clinic_id = $1 FOR UPDATE', [request.clinicId]);
      if (clinicRow.rows.length === 0) {
        throw new Error('CLINIC_NOT_FOUND');
      }

      const clinicState = this.buildClinicStateFromRow(clinicRow.rows[0]);
      const clinicEligibility = canClinicSubmitClaim(clinicState);
      if (!clinicEligibility.allowed) {
        throw new Error(clinicEligibility.reason);
      }

      // FIX 5: License must be valid AS OF dateOfService
      if (clinicState.licenseExpiresAt && clinicState.licenseExpiresAt < request.dateOfService) {
        throw new Error('CLINIC_LICENSE_INVALID_FOR_SERVICE_DATE');
      }

      // HAZARD 5: Capture license check evidence with source and dual timestamps
      const occurredAt = new Date();
      const licenseCheckEvidence = {
        licenseNumber: clinicState.licenseNumber || 'UNKNOWN',
        licenseStatus: clinicState.licenseStatus,
        licenseExpiresAt: clinicState.licenseExpiresAt?.toISOString() || '',
        licenseEvidenceSource: 'vet_clinics_projection',  // Source of truth
        licenseCheckedAtOccurred: occurredAt.toISOString(),  // Client/business time
        licenseCheckedAtIngested: occurredAt.toISOString(),  // Will be replaced by server on event append
        validForDateOfService: true,
      };

      // Validate voucher and dates (LAW 7.2)
      const voucherRow = await client.query('SELECT * FROM vouchers_projection WHERE voucher_id = $1 FOR UPDATE', [request.voucherId]);
      if (voucherRow.rows.length === 0) {
        throw new Error('VOUCHER_NOT_FOUND');
      }
      if (voucherRow.rows[0].status !== 'ISSUED' && voucherRow.rows[0].status !== 'REDEEMED') {
        throw new Error('VOUCHER_NOT_VALID');
      }
      if (voucherRow.rows[0].is_lirp && request.coPayCollectedCents && request.coPayCollectedCents > 0n) {
        throw new Error('LIRP_COPAY_FORBIDDEN');
      }

      // Get grant period and submission deadline (hardcoded for FY2026, should come from grant record)
      const grantPeriodStart = new Date('2025-07-01');
      const grantPeriodEnd = new Date('2026-06-30');
      const submissionDeadline = new Date('2026-11-15');
      const voucherIssuedAt = new Date(voucherRow.rows[0].issued_at);
      const voucherExpiresAt = new Date(voucherRow.rows[0].expires_at);

      const validation = validateClaimSubmission(
        request.dateOfService,
        voucherIssuedAt,
        voucherExpiresAt,
        grantPeriodStart,
        grantPeriodEnd,
        submissionDeadline,
        new Date()
      );

      if (!validation.valid) {
        throw new Error(validation.reason);
      }

      // Emit CLAIM_SUBMITTED event with claimFingerprint and licenseCheckEvidence
      const event: Omit<DomainEvent, 'ingestedAt'> = {
        eventId: EventStore.newEventId(),
        aggregateType: 'CLAIM',
        aggregateId: claimId,
        eventType: 'CLAIM_SUBMITTED',
        eventData: {
          claimFingerprint,
          grantCycleId: request.grantCycleId,
          voucherId: request.voucherId,
          clinicId: request.clinicId,
          procedureCode: request.procedureCode,
          dateOfService: request.dateOfService.toISOString().split('T')[0],
          submittedAmountCents: request.submittedAmountCents.toString(),
          artifacts: request.artifacts,
          licenseCheckEvidence,
        },
        occurredAt: new Date(),
        grantCycleId: request.grantCycleId,
        correlationId: request.correlationId,
        causationId: request.causationId ?? null,
        actorId: request.actorId as ActorId,
        actorType: request.actorType,
      };

      await this.store.append(event);

      // Update projection
      await this.updateClaimProjection(client, claimId);

      const response = { claimId };
      await this.idempotency.recordResult(client, request.idempotencyKey, response);

      await client.query('COMMIT');
      return response;
    } catch (error) {
      await client.query('ROLLBACK');
      try {
        await this.idempotency.recordFailure(client, request.idempotencyKey);
      } catch {
        // Swallow idempotency failure to preserve original error.
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async adjudicateClaim(request: {
    idempotencyKey: string;
    claimId: ClaimId;
    decision: 'APPROVE' | 'DENY';
    approvedAmountCents?: MoneyCents;
    decisionBasis: DecisionBasis;
    actorId: string;
    actorType: 'ADMIN' | 'SYSTEM';
    correlationId: string;
    causationId?: string;
  }): Promise<{ success: boolean; conflictDetected?: boolean }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const status = await this.idempotency.checkAndReserve(client, request.idempotencyKey, 'ADJUDICATE_CLAIM', 'hash', 86400);
      if (status === 'COMPLETED') {
        const result = await client.query('SELECT response_json FROM idempotency_cache WHERE idempotency_key = $1', [request.idempotencyKey]);
        return result.rows[0].response_json;
      }
      if (status === 'PROCESSING') {
        throw new Error('OPERATION_IN_PROGRESS');
      }

      // Lock claim for adjudication
      const claimRow = await client.query('SELECT * FROM claims_projection WHERE claim_id = $1 FOR UPDATE', [request.claimId]);
      if (claimRow.rows.length === 0) {
        throw new Error('CLAIM_NOT_FOUND');
      }

      const claimGrantCycleId = claimRow.rows[0].grant_cycle_id;
      const currentStatus = claimRow.rows[0].status;
      if (currentStatus !== 'SUBMITTED' && currentStatus !== 'ADJUSTED') {
        // Check if already decided - this is a conflict
        const conflictEvent: Omit<DomainEvent, 'ingestedAt'> = {
          eventId: EventStore.newEventId(),
          aggregateType: 'CLAIM',
          aggregateId: request.claimId,
          eventType: 'CLAIM_DECISION_CONFLICT_RECORDED',
          eventData: {
            attemptedDecision: request.decision,
            currentStatus,
            decisionBasis: {
              policySnapshotId: request.decisionBasis.policySnapshotId,
              decidedBy: request.decisionBasis.decidedBy,
              decidedAt: request.decisionBasis.decidedAt.toISOString(),
              reason: request.decisionBasis.reason,
            },
          },
          occurredAt: new Date(),
          grantCycleId: claimGrantCycleId,
          correlationId: request.correlationId,
          causationId: request.causationId ?? null,
          actorId: request.actorId as ActorId,
          actorType: request.actorType,
        };

        await this.store.append(conflictEvent);

        const response = { success: false, conflictDetected: true };
        await this.idempotency.recordResult(client, request.idempotencyKey, response);
        await client.query('COMMIT');
        return response;
      }

      // Emit decision event
      const eventType = request.decision === 'APPROVE' ? 'CLAIM_APPROVED' : 'CLAIM_DENIED';
      const eventData: any = {
        decisionBasis: {
          policySnapshotId: request.decisionBasis.policySnapshotId,
          decidedBy: request.decisionBasis.decidedBy,
          decidedAt: request.decisionBasis.decidedAt.toISOString(),
          reason: request.decisionBasis.reason,
        },
      };

      if (request.decision === 'APPROVE') {
        if (!request.approvedAmountCents) {
          throw new Error('APPROVED_AMOUNT_REQUIRED');
        }
        eventData.approvedAmountCents = request.approvedAmountCents.toString();
      }

      const event: Omit<DomainEvent, 'ingestedAt'> = {
        eventId: EventStore.newEventId(),
        aggregateType: 'CLAIM',
        aggregateId: request.claimId,
        eventType,
        eventData,
        occurredAt: new Date(),
        grantCycleId: claimGrantCycleId,
        correlationId: request.correlationId,
        causationId: request.causationId ?? null,
        actorId: request.actorId as ActorId,
        actorType: request.actorType,
      };

      await this.store.append(event);

      // If approved, emit GRANT_FUNDS_LIQUIDATED
      if (request.decision === 'APPROVE' && request.approvedAmountCents) {
        const voucherId = claimRow.rows[0].voucher_id;
        const voucherRow = await client.query('SELECT grant_id, is_lirp FROM vouchers_projection WHERE voucher_id = $1', [voucherId]);
        const grantId = voucherRow.rows[0].grant_id;

        const liquidationEvent: Omit<DomainEvent, 'ingestedAt'> = {
          eventId: EventStore.newEventId(),
          aggregateType: 'GRANT',
          aggregateId: grantId,
          eventType: 'GRANT_FUNDS_LIQUIDATED',
          eventData: {
            claimId: request.claimId,
            amountCents: request.approvedAmountCents.toString(),
            isLIRP: voucherRow.rows[0].is_lirp,
          },
          occurredAt: new Date(),
          grantCycleId: claimGrantCycleId,
          correlationId: request.correlationId,
          causationId: event.eventId,
          actorId: request.actorId as ActorId,
          actorType: request.actorType,
        };

        await this.store.append(liquidationEvent);
      }

      // Update projections
      await this.updateClaimProjection(client, request.claimId);

      const response = { success: true, conflictDetected: false };
      await this.idempotency.recordResult(client, request.idempotencyKey, response);

      await client.query('COMMIT');
      return response;
    } catch (error) {
      await client.query('ROLLBACK');
      try {
        await this.idempotency.recordFailure(client, request.idempotencyKey);
      } catch {
        // Swallow idempotency failure to preserve original error.
      }
      throw error;
    } finally {
      client.release();
    }
  }

  private buildClinicStateFromRow(row: any): ClinicState {
    const state = createInitialClinicState(row.clinic_id, row.clinic_name);
    state.status = row.status;
    state.licenseStatus = row.license_status;
    state.licenseNumber = row.license_number;
    state.licenseExpiresAt = row.license_expires_at ? new Date(row.license_expires_at) : null;
    state.oasisVendorCode = row.oasis_vendor_code;
    state.paymentInfo = row.payment_info;
    state.registeredAt = row.registered_at ? new Date(row.registered_at) : null;
    state.suspendedAt = row.suspended_at ? new Date(row.suspended_at) : null;
    state.reinstatedAt = row.reinstated_at ? new Date(row.reinstated_at) : null;
    return state;
  }

  private async updateClaimProjection(client: PoolClient, claimId: ClaimId): Promise<void> {
    const eventRows = await client.query(`
      SELECT event_id, event_type, event_data, ingested_at
      FROM event_log
      WHERE aggregate_id = $1
      ORDER BY ingested_at ASC, event_id ASC
    `, [claimId]);

    if (eventRows.rows.length === 0) return;

    const firstEvent = eventRows.rows[0].event_data;
    const state = createInitialClaimState(
      claimId,
      firstEvent.claimFingerprint as ClaimFingerprint,
      firstEvent.grantCycleId as string,
      firstEvent.voucherId as VoucherId,
      firstEvent.clinicId as string,
      firstEvent.procedureCode as string,
      new Date(firstEvent.dateOfService as string)
    );

    for (const row of eventRows.rows) {
      const event = {
        eventType: row.event_type,
        eventData: row.event_data,
        ingestedAt: row.ingested_at,
        eventId: row.event_id,
      };
      applyClaimEvent(state, event);
    }
    checkClaimInvariant(state);

    // HAZARD 2: Atomic de-dupe via unique constraint + ON CONFLICT
    // If fingerprint collision occurs, the unique constraint will catch it
    const result = await client.query(`
      INSERT INTO claims_projection (
        claim_id, claim_fingerprint, grant_cycle_id, voucher_id, clinic_id, procedure_code, date_of_service, status,
        submitted_amount_cents, approved_amount_cents, decision_basis, invoice_id,
        submitted_at, approved_at, approved_event_id, denied_at, adjusted_at, invoiced_at,
        rebuilt_at, watermark_ingested_at, watermark_event_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
      ON CONFLICT (claim_id) DO UPDATE SET
        status = EXCLUDED.status,
        approved_amount_cents = EXCLUDED.approved_amount_cents,
        decision_basis = EXCLUDED.decision_basis,
        invoice_id = EXCLUDED.invoice_id,
        approved_at = EXCLUDED.approved_at,
        approved_event_id = EXCLUDED.approved_event_id,
        denied_at = EXCLUDED.denied_at,
        adjusted_at = EXCLUDED.adjusted_at,
        invoiced_at = EXCLUDED.invoiced_at,
        rebuilt_at = EXCLUDED.rebuilt_at,
        watermark_ingested_at = EXCLUDED.watermark_ingested_at,
        watermark_event_id = EXCLUDED.watermark_event_id
      RETURNING claim_id
    `, [
      state.claimId, state.claimFingerprint, state.grantCycleId, state.voucherId, state.clinicId, state.procedureCode, state.dateOfService,
      state.status, state.submittedAmountCents.toString(), state.approvedAmountCents ? state.approvedAmountCents.toString() : null,
      state.decisionBasis ? JSON.stringify(state.decisionBasis) : null, state.invoiceId,
      state.submittedAt, state.approvedAt, state.approvedEventId, state.deniedAt, state.adjustedAt, state.invoicedAt,
      new Date(), eventRows.rows[eventRows.rows.length - 1]?.ingested_at || new Date(), eventRows.rows[eventRows.rows.length - 1]?.event_id || EventStore.newEventId()
    ]);
    
    // If fingerprint constraint violated, this will throw and rollback transaction
    return result.rows[0].claim_id;
  }
}
