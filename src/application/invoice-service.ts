import { Pool, PoolClient } from 'pg';
import { EventStore, DomainEvent } from '../event-store';
import { IdempotencyService } from './idempotency-service';
import { MoneyCents, Money, ActorId } from '../domain-types';
import { applyInvoiceEvent, InvoiceState, checkInvoiceInvariant, createInitialInvoiceState, computeInvoiceStatus, generateMonthlyInvoicePeriod, applyAdjustmentEvent, AdjustmentState, createInitialAdjustmentState } from '../domain/invoice/invoice-logic';

export class InvoiceService {
  constructor(private pool: Pool, private store: EventStore, private idempotency: IdempotencyService) {}

  async generateMonthlyInvoices(request: {
    idempotencyKey: string;
    year: number;
    month: number;
    watermarkIngestedAt: Date;  // HAZARD 4: Dual watermark tuple for deterministic replay
    watermarkEventId: string;   // HAZARD 4: Handles events with identical timestamps
    actorId: string;
    actorType: 'ADMIN' | 'SYSTEM';
    correlationId: string;
  }): Promise<{ invoiceIds: string[] }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const status = await this.idempotency.checkAndReserve(client, request.idempotencyKey, 'GENERATE_MONTHLY_INVOICES', 'hash', 86400);
      if (status === 'COMPLETED') {
        const result = await client.query('SELECT response_json FROM idempotency_cache WHERE idempotency_key = $1', [request.idempotencyKey]);
        return result.rows[0].response_json;
      }
      if (status === 'PROCESSING') {
        throw new Error('OPERATION_IN_PROGRESS');
      }

      // FIX 3: LAW 7.3 - Deterministic period boundaries (calendar rules, not NOW())
      const { start, end } = generateMonthlyInvoicePeriod(request.year, request.month);

      // HAZARD 3 + HAZARD 4 FIX: Use EVENT timestamps only (approved_at is ingestedAt from CLAIM_APPROVED event)
      // Selection uses dual watermark tuple for deterministic replay (handles identical timestamps)
      // FIX: Compare approved_event_id (UUIDv7) not claim_id (UUIDv4) for correct ordering
      const claimsResult = await client.query(`
        SELECT claim_id, clinic_id, grant_cycle_id, approved_amount_cents, approved_at, approved_event_id
        FROM claims_projection
        WHERE status = 'APPROVED'
          AND invoice_id IS NULL
          AND approved_at >= $1
          AND approved_at <= $2
          AND (approved_at < $3 OR (approved_at = $3 AND approved_event_id <= $4))
        ORDER BY clinic_id, approved_at, approved_event_id
        FOR UPDATE
      `, [start, end, request.watermarkIngestedAt, request.watermarkEventId]);

      // Group claims by clinic
      const claimsByClinic = new Map<string, { clinicId: string; grantCycleId: string; claims: any[] }>();
      for (const row of claimsResult.rows) {
        const key = `${row.clinic_id}:${row.grant_cycle_id}`;
        if (!claimsByClinic.has(key)) {
          claimsByClinic.set(key, { clinicId: row.clinic_id, grantCycleId: row.grant_cycle_id, claims: [] });
        }
        claimsByClinic.get(key)!.claims.push(row);
      }

      const invoiceIds: string[] = [];

      // Generate invoice for each clinic
      for (const [, group] of claimsByClinic) {
        const { clinicId, grantCycleId, claims } = group;
        const invoiceId = EventStore.newEventId();
        const claimIds = claims.map(c => c.claim_id);
        
        // Calculate total from claims
        let totalCents = 0n;
        for (const claim of claims) {
          totalCents = Money.fromBigInt(totalCents + BigInt(claim.approved_amount_cents));
        }

        // Apply carry-forward adjustments for this clinic
        const adjustmentsResult = await client.query(`
          SELECT adjustment_id, source_invoice_id, amount_cents
          FROM invoice_adjustments_projection
          WHERE grant_cycle_id = $1
            AND target_invoice_id IS NULL
            AND (clinic_id = $2 OR clinic_id IS NULL)
          ORDER BY created_at
        `, [grantCycleId, clinicId]);
        const clinicAdjustments = adjustmentsResult.rows;

        const adjustmentIds = clinicAdjustments.map(a => a.adjustment_id);
        for (const adj of clinicAdjustments) {
          totalCents = Money.fromBigInt(totalCents + BigInt(adj.amount_cents));
        }

        // HAZARD 4: Emit INVOICE_GENERATED event with dual watermark tuple for deterministic replay
        const event: Omit<DomainEvent, 'ingestedAt'> = {
          eventId: EventStore.newEventId(),
          aggregateType: 'INVOICE',
          aggregateId: invoiceId,
          eventType: 'INVOICE_GENERATED',
          eventData: {
            clinicId,
            periodStart: start.toISOString().split('T')[0],
            periodEnd: end.toISOString().split('T')[0],
            watermarkIngestedAt: request.watermarkIngestedAt.toISOString(),
            watermarkEventId: request.watermarkEventId,
            claimIds,
            adjustmentIds,
            totalAmountCents: totalCents.toString(),
          },
          occurredAt: new Date(),
          grantCycleId,
          correlationId: request.correlationId,
          causationId: null,
          actorId: request.actorId as ActorId,
          actorType: request.actorType,
        };

        await this.store.append(event);

        // Emit CLAIM_INVOICED for each claim
        for (const claimId of claimIds) {
          const claimEvent: Omit<DomainEvent, 'ingestedAt'> = {
            eventId: EventStore.newEventId(),
            aggregateType: 'CLAIM',
            aggregateId: claimId,
            eventType: 'CLAIM_INVOICED',
            eventData: {
              invoiceId,
            },
            occurredAt: new Date(),
            grantCycleId,
            correlationId: request.correlationId,
            causationId: event.eventId,
            actorId: request.actorId as ActorId,
            actorType: request.actorType,
          };
          await this.store.append(claimEvent);
          await client.query(
            `UPDATE claims_projection
             SET status = 'INVOICED', invoice_id = $2, invoiced_at = $3
             WHERE claim_id = $1`,
            [claimId, invoiceId, new Date()]
          );
        }

        // Emit INVOICE_ADJUSTMENT_APPLIED for each adjustment
        for (const adjustmentId of adjustmentIds) {
          const adjEvent: Omit<DomainEvent, 'ingestedAt'> = {
            eventId: EventStore.newEventId(),
            aggregateType: 'ADJUSTMENT',
            aggregateId: adjustmentId,
            eventType: 'INVOICE_ADJUSTMENT_APPLIED',
            eventData: {
              targetInvoiceId: invoiceId,
            },
            occurredAt: new Date(),
            grantCycleId,
            correlationId: request.correlationId,
            causationId: event.eventId,
            actorId: request.actorId as ActorId,
            actorType: request.actorType,
          };
          await this.store.append(adjEvent);
        }

        invoiceIds.push(invoiceId);
      }

      // Update projections
      for (const invoiceId of invoiceIds) {
        await this.updateInvoiceProjection(client, invoiceId);
      }

      const response = { invoiceIds };
      await this.idempotency.recordResult(client, request.idempotencyKey, response);

      await client.query('COMMIT');
      return response;
    } catch (error) {
      await this.idempotency.recordFailure(client, request.idempotencyKey);
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async recordPayment(request: {
    idempotencyKey: string;
    invoiceId: string;
    amountCents: MoneyCents;
    paymentChannel: string;
    referenceId?: string;
    actorId: string;
    actorType: 'ADMIN' | 'SYSTEM';
    correlationId: string;
  }): Promise<{ paymentId: string }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const status = await this.idempotency.checkAndReserve(client, request.idempotencyKey, 'RECORD_PAYMENT', 'hash', 86400);
      if (status === 'COMPLETED') {
        const result = await client.query('SELECT response_json FROM idempotency_cache WHERE idempotency_key = $1', [request.idempotencyKey]);
        return result.rows[0].response_json;
      }
      if (status === 'PROCESSING') {
        throw new Error('OPERATION_IN_PROGRESS');
      }

      const paymentId = EventStore.newEventId();

      // Lookup grant_cycle_id from invoice
      const invoiceRow = await client.query(
        'SELECT grant_cycle_id FROM invoices_projection WHERE invoice_id = $1',
        [request.invoiceId]
      );
      if (invoiceRow.rows.length === 0) {
        throw new Error('INVOICE_NOT_FOUND');
      }
      const grantCycleId = invoiceRow.rows[0].grant_cycle_id;

      // Emit PAYMENT_RECORDED event
      const event: Omit<DomainEvent, 'ingestedAt'> = {
        eventId: EventStore.newEventId(),
        aggregateType: 'PAYMENT',
        aggregateId: paymentId,
        eventType: 'PAYMENT_RECORDED',
        eventData: {
          invoiceId: request.invoiceId,
          amountCents: request.amountCents.toString(),
          paymentChannel: request.paymentChannel,
          referenceId: request.referenceId,
        },
        occurredAt: new Date(),
        grantCycleId,
        correlationId: request.correlationId,
        causationId: null,
        actorId: request.actorId as ActorId,
        actorType: request.actorType,
      };

      await this.store.append(event);

      // Update payment projection
      await client.query(`
        INSERT INTO payments_projection (
          payment_id, invoice_id, amount_cents, payment_channel, reference_id,
          recorded_at, rebuilt_at, watermark_ingested_at, watermark_event_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `, [
        paymentId, request.invoiceId, request.amountCents.toString(), request.paymentChannel, request.referenceId,
        new Date(), new Date(), new Date(), EventStore.newEventId()
      ]);

      // Update invoice projection status (projection-derived)
      await this.updateInvoiceProjection(client, request.invoiceId);

      const response = { paymentId };
      await this.idempotency.recordResult(client, request.idempotencyKey, response);

      await client.query('COMMIT');
      return response;
    } catch (error) {
      await this.idempotency.recordFailure(client, request.idempotencyKey);
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async updateInvoiceProjection(client: PoolClient, invoiceId: string): Promise<void> {
    const eventRows = await client.query(`
      SELECT event_type, event_data, ingested_at, grant_cycle_id
      FROM event_log
      WHERE aggregate_id = $1
      ORDER BY ingested_at ASC, event_id ASC
    `, [invoiceId]);

    if (eventRows.rows.length === 0) return;

    const firstEvent = eventRows.rows[0].event_data;
    const grantCycleId = eventRows.rows[0].grant_cycle_id;
    const state = createInitialInvoiceState(
      invoiceId,
      firstEvent.clinicId as string,
      new Date(firstEvent.periodStart as string),
      new Date(firstEvent.periodEnd as string)
    );

    for (const row of eventRows.rows) {
      const event = {
        eventType: row.event_type,
        eventData: row.event_data,
        ingestedAt: row.ingested_at,
      };
      applyInvoiceEvent(state, event);
    }
    checkInvoiceInvariant(state);

    // Calculate payment status (projection-derived per LAW 7.6)
    const paymentsResult = await client.query(`
      SELECT COALESCE(SUM(amount_cents), 0) as total_paid
      FROM payments_projection
      WHERE invoice_id = $1
    `, [invoiceId]);

    const totalPaidCents = Money.fromBigInt(BigInt(paymentsResult.rows[0].total_paid));
    const derivedStatus = computeInvoiceStatus(state.totalAmountCents, totalPaidCents, state.status === 'SUBMITTED');

    await client.query(`
      INSERT INTO invoices_projection (
        invoice_id, clinic_id, grant_cycle_id, invoice_period_start, invoice_period_end,
        total_amount_cents, claim_ids, adjustment_ids, status, submitted_at, generated_at,
        rebuilt_at, watermark_ingested_at, watermark_event_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      ON CONFLICT (invoice_id) DO UPDATE SET
        grant_cycle_id = EXCLUDED.grant_cycle_id,
        status = EXCLUDED.status,
        submitted_at = EXCLUDED.submitted_at,
        rebuilt_at = EXCLUDED.rebuilt_at,
        watermark_ingested_at = EXCLUDED.watermark_ingested_at,
        watermark_event_id = EXCLUDED.watermark_event_id
    `, [
      state.invoiceId, state.clinicId, grantCycleId, state.periodStart, state.periodEnd,
      state.totalAmountCents.toString(), JSON.stringify(state.claimIds), JSON.stringify(state.adjustmentIds),
      derivedStatus, state.submittedAt, state.generatedAt,
      new Date(), eventRows.rows[eventRows.rows.length - 1]?.ingested_at || new Date(), eventRows.rows[eventRows.rows.length - 1]?.event_id || crypto.randomUUID()
    ]);
  }
}
