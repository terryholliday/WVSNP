import { Pool, PoolClient } from 'pg';
import * as crypto from 'crypto';
import { EventStore, DomainEvent } from '../event-store';
import { IdempotencyService } from './idempotency-service';
import { ActorId, MoneyCents, Money, GrantCycleCloseout } from '../domain-types';
import {
  createInitialCycleCloseoutState,
  applyCycleCloseoutEvent,
  checkCycleCloseoutInvariant,
  canStartCloseout,
  canCloseout,
  PreflightCheck,
  FinancialSummary,
  MatchingFundsSummary,
  ActivitySummary,
} from '../domain/closeout/cycle-logic';

export class CloseoutService {
  constructor(
    private pool: Pool,
    private store: EventStore,
    private idempotency: IdempotencyService
  ) {}

  async runPreflight(request: {
    idempotencyKey: string;
    grantCycleId: string;
    actorId: string;
    actorType: 'ADMIN' | 'SYSTEM';
    correlationId: string;
  }): Promise<{ status: 'PASSED' | 'FAILED'; checks: PreflightCheck[] }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Run all preflight checks
      const checks: PreflightCheck[] = [];

      // Check 1: All approved claims invoiced
      const uninvoicedClaims = await client.query(`
        SELECT COUNT(*) as count
        FROM claims_projection
        WHERE grant_cycle_id = $1
          AND status = 'APPROVED'
          AND invoice_id IS NULL
      `, [request.grantCycleId]);
      checks.push({
        check: 'ALL_APPROVED_CLAIMS_INVOICED',
        pass: parseInt(uninvoicedClaims.rows[0].count) === 0,
        details: `${uninvoicedClaims.rows[0].count} approved claims not invoiced`,
      });

      // Check 2: All submitted invoices exported
      const unexportedInvoices = await client.query(`
        SELECT COUNT(*) as count
        FROM invoices_projection
        WHERE grant_cycle_id = $1
          AND status = 'SUBMITTED'
          AND oasis_export_batch_id IS NULL
      `, [request.grantCycleId]);
      checks.push({
        check: 'ALL_SUBMITTED_INVOICES_EXPORTED',
        pass: parseInt(unexportedInvoices.rows[0].count) === 0,
        details: `${unexportedInvoices.rows[0].count} submitted invoices not exported`,
      });

      // Check 3: All export batches acknowledged
      const unacknowledgedBatches = await client.query(`
        SELECT COUNT(*) as count
        FROM oasis_export_batches_projection
        WHERE grant_cycle_id = $1
          AND status NOT IN ('ACKNOWLEDGED', 'VOIDED')
      `, [request.grantCycleId]);
      checks.push({
        check: 'ALL_EXPORT_BATCHES_ACKNOWLEDGED',
        pass: parseInt(unacknowledgedBatches.rows[0].count) === 0,
        details: `${unacknowledgedBatches.rows[0].count} export batches not acknowledged`,
      });

      // Check 4: All payments recorded
      const unpaidInvoices = await client.query(`
        SELECT COUNT(*) as count
        FROM invoices_projection
        WHERE grant_cycle_id = $1
          AND status = 'SUBMITTED'
          AND invoice_id NOT IN (SELECT DISTINCT invoice_id FROM payments_projection)
      `, [request.grantCycleId]);
      checks.push({
        check: 'ALL_PAYMENTS_RECORDED',
        pass: parseInt(unpaidInvoices.rows[0].count) === 0,
        details: `${unpaidInvoices.rows[0].count} invoices without payment`,
      });

      // Check 5: No pending adjustments
      const pendingAdjustments = await client.query(`
        SELECT COUNT(*) as count
        FROM invoice_adjustments_projection
        WHERE grant_cycle_id = $1
          AND target_invoice_id IS NULL
      `, [request.grantCycleId]);
      checks.push({
        check: 'NO_PENDING_ADJUSTMENTS',
        pass: parseInt(pendingAdjustments.rows[0].count) === 0,
        details: `${pendingAdjustments.rows[0].count} unapplied adjustments`,
      });

      // Check 6: Matching funds reported
      const matchingFunds = await client.query(`
        SELECT SUM(matching_committed_cents) as committed, SUM(matching_reported_cents) as reported
        FROM grant_balances_projection
        WHERE grant_cycle_id = $1
      `, [request.grantCycleId]);
      const committed = BigInt(matchingFunds.rows[0].committed || 0);
      const reported = BigInt(matchingFunds.rows[0].reported || 0);
      checks.push({
        check: 'MATCHING_FUNDS_REPORTED',
        pass: reported >= committed,
        details: `Committed: ${committed}, Reported: ${reported}`,
      });

      const allPassed = checks.every(c => c.pass);
      const status = allPassed ? 'PASSED' : 'FAILED';

      // Emit GRANT_CYCLE_CLOSEOUT_PREFLIGHT_COMPLETED
      const closeoutAggregateId = GrantCycleCloseout.createAggregateId(request.grantCycleId);

      const preflightEvent: Omit<DomainEvent, 'ingestedAt'> = {
        eventId: EventStore.newEventId(),
        aggregateType: 'GRANT_CYCLE_CLOSEOUT',
        aggregateId: closeoutAggregateId,
        eventType: 'GRANT_CYCLE_CLOSEOUT_PREFLIGHT_COMPLETED',
        eventData: {
          grantCycleId: request.grantCycleId,
          status,
          checks,
          initiatedByActorId: request.actorId,
        },
        occurredAt: new Date(),
        grantCycleId: request.grantCycleId,
        correlationId: request.correlationId,
        causationId: null,
        actorId: request.actorId as ActorId,
        actorType: request.actorType,
      };
      await this.store.append(preflightEvent);

      await this.updateCloseoutProjection(client, request.grantCycleId);

      await client.query('COMMIT');
      return { status, checks };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async startCloseout(request: {
    idempotencyKey: string;
    grantCycleId: string;
    actorId: string;
    actorType: 'ADMIN';
    correlationId: string;
  }): Promise<{ status: string }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Check preflight passed
      const closeoutRow = await client.query(
        'SELECT closeout_status, preflight_status FROM grant_cycle_closeout_projection WHERE grant_cycle_id = $1',
        [request.grantCycleId]
      );

      if (closeoutRow.rows.length === 0 || closeoutRow.rows[0].preflight_status !== 'PASSED') {
        throw new Error('PREFLIGHT_NOT_PASSED');
      }

      if (closeoutRow.rows[0].closeout_status !== 'PREFLIGHT_PASSED') {
        throw new Error('CLOSEOUT_ALREADY_STARTED');
      }

      // Emit GRANT_CYCLE_CLOSEOUT_STARTED
      const closeoutAggregateId = GrantCycleCloseout.createAggregateId(request.grantCycleId);

      const startedEvent: Omit<DomainEvent, 'ingestedAt'> = {
        eventId: EventStore.newEventId(),
        aggregateType: 'GRANT_CYCLE_CLOSEOUT',
        aggregateId: closeoutAggregateId,
        eventType: 'GRANT_CYCLE_CLOSEOUT_STARTED',
        eventData: {
          grantCycleId: request.grantCycleId,
          startedByActorId: request.actorId,
        },
        occurredAt: new Date(),
        grantCycleId: request.grantCycleId,
        correlationId: request.correlationId,
        causationId: null,
        actorId: request.actorId as ActorId,
        actorType: request.actorType,
      };
      await this.store.append(startedEvent);

      await this.updateCloseoutProjection(client, request.grantCycleId);

      await client.query('COMMIT');
      return { status: 'STARTED' };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async reconcile(request: {
    idempotencyKey: string;
    grantCycleId: string;
    watermarkIngestedAt: Date;
    watermarkEventId: string;
    actorId: string;
    actorType: 'ADMIN' | 'SYSTEM';
    correlationId: string;
  }): Promise<{ status: string }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Calculate financial summary
      const balances = await client.query(`
        SELECT 
          SUM(awarded_cents) as awarded,
          SUM(encumbered_cents) as encumbered,
          SUM(liquidated_cents) as liquidated,
          SUM(released_cents) as released,
          SUM(available_cents) as available
        FROM grant_balances_projection
        WHERE grant_cycle_id = $1
      `, [request.grantCycleId]);

      const awarded = BigInt(balances.rows[0].awarded || 0);
      const encumbered = BigInt(balances.rows[0].encumbered || 0);
      const liquidated = BigInt(balances.rows[0].liquidated || 0);
      const released = BigInt(balances.rows[0].released || 0);
      const unspent = BigInt(balances.rows[0].available || 0);

      const financialSummary: FinancialSummary = {
        awardedCents: Money.fromBigInt(awarded),
        encumberedCents: Money.fromBigInt(encumbered),
        liquidatedCents: Money.fromBigInt(liquidated),
        releasedCents: Money.fromBigInt(released),
        unspentCents: Money.fromBigInt(unspent),
      };

      // Calculate matching funds
      const matching = await client.query(`
        SELECT 
          SUM(matching_committed_cents) as committed,
          SUM(matching_reported_cents) as reported
        FROM grant_balances_projection
        WHERE grant_cycle_id = $1
      `, [request.grantCycleId]);

      const committed = BigInt(matching.rows[0].committed || 0);
      const reported = BigInt(matching.rows[0].reported || 0);
      const shortfall = committed - reported;

      const matchingFunds: MatchingFundsSummary = {
        committedCents: Money.fromBigInt(committed),
        reportedCents: Money.fromBigInt(reported),
        shortfallCents: Money.fromBigInt(shortfall > 0n ? shortfall : 0n),
        surplusCents: Money.fromBigInt(shortfall < 0n ? -shortfall : 0n),
        evidenceArtifactIds: [],
      };

      // Calculate activity summary
      const vouchers = await client.query(`
        SELECT 
          COUNT(*) FILTER (WHERE status = 'ISSUED') as issued,
          COUNT(*) FILTER (WHERE status = 'REDEEMED') as redeemed,
          COUNT(*) FILTER (WHERE status = 'EXPIRED') as expired,
          COUNT(*) FILTER (WHERE status = 'VOIDED') as voided
        FROM vouchers_projection
        WHERE grant_id IN (SELECT DISTINCT grant_id FROM grant_balances_projection WHERE grant_cycle_id = $1)
      `, [request.grantCycleId]);

      const claims = await client.query(`
        SELECT 
          COUNT(*) FILTER (WHERE status = 'SUBMITTED') as submitted,
          COUNT(*) FILTER (WHERE status = 'APPROVED') as approved,
          COUNT(*) FILTER (WHERE status = 'DENIED') as denied,
          COUNT(*) FILTER (WHERE status = 'ADJUSTED') as adjusted
        FROM claims_projection
        WHERE grant_cycle_id = $1
      `, [request.grantCycleId]);

      const invoices = await client.query(`
        SELECT 
          COUNT(*) FILTER (WHERE status = 'GENERATED') as generated,
          COUNT(*) FILTER (WHERE status = 'PAID') as paid
        FROM invoices_projection
        WHERE grant_cycle_id = $1
      `, [request.grantCycleId]);

      const activitySummary: ActivitySummary = {
        vouchersIssued: parseInt(vouchers.rows[0].issued || 0),
        vouchersRedeemed: parseInt(vouchers.rows[0].redeemed || 0),
        vouchersExpired: parseInt(vouchers.rows[0].expired || 0),
        vouchersVoided: parseInt(vouchers.rows[0].voided || 0),
        claimsSubmitted: parseInt(claims.rows[0].submitted || 0),
        claimsApproved: parseInt(claims.rows[0].approved || 0),
        claimsDenied: parseInt(claims.rows[0].denied || 0),
        claimsAdjusted: parseInt(claims.rows[0].adjusted || 0),
        invoicesGenerated: parseInt(invoices.rows[0].generated || 0),
        invoicesPaid: parseInt(invoices.rows[0].paid || 0),
        dogSpays: 0,
        dogNeuters: 0,
        catSpays: 0,
        catNeuters: 0,
        communityCatSpays: 0,
        communityCatNeuters: 0,
        totalAnimalsServed: 0,
        countiesCovered: [],
      };

      // Emit GRANT_CYCLE_CLOSEOUT_RECONCILED
      const closeoutAggregateId = GrantCycleCloseout.createAggregateId(request.grantCycleId);

      const reconciledEvent: Omit<DomainEvent, 'ingestedAt'> = {
        eventId: EventStore.newEventId(),
        aggregateType: 'GRANT_CYCLE_CLOSEOUT',
        aggregateId: closeoutAggregateId,
        eventType: 'GRANT_CYCLE_CLOSEOUT_RECONCILED',
        eventData: {
          grantCycleId: request.grantCycleId,
          watermarkIngestedAt: request.watermarkIngestedAt.toISOString(),
          watermarkEventId: request.watermarkEventId,
          financialSummary: {
            awardedCents: financialSummary.awardedCents.toString(),
            encumberedCents: financialSummary.encumberedCents.toString(),
            liquidatedCents: financialSummary.liquidatedCents.toString(),
            releasedCents: financialSummary.releasedCents.toString(),
            unspentCents: financialSummary.unspentCents.toString(),
          },
          matchingFunds: {
            committedCents: matchingFunds.committedCents.toString(),
            reportedCents: matchingFunds.reportedCents.toString(),
            shortfallCents: matchingFunds.shortfallCents.toString(),
            surplusCents: matchingFunds.surplusCents.toString(),
            evidenceArtifactIds: matchingFunds.evidenceArtifactIds,
          },
          activitySummary,
        },
        occurredAt: new Date(),
        grantCycleId: request.grantCycleId,
        correlationId: request.correlationId,
        causationId: null,
        actorId: request.actorId as ActorId,
        actorType: request.actorType,
      };
      await this.store.append(reconciledEvent);

      await this.updateCloseoutProjection(client, request.grantCycleId);

      await client.query('COMMIT');
      return { status: 'RECONCILED' };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async close(request: {
    idempotencyKey: string;
    grantCycleId: string;
    actorId: string;
    actorType: 'ADMIN';
    correlationId: string;
  }): Promise<{ status: string }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Rebuild state to check if close is allowed
      const closeoutAggId = GrantCycleCloseout.createAggregateId(request.grantCycleId);
      const eventRows = await client.query(`
        SELECT event_id, event_type, event_data, ingested_at
        FROM event_log
        WHERE aggregate_id = $1 AND aggregate_type = 'GRANT_CYCLE_CLOSEOUT'
        ORDER BY ingested_at ASC, event_id ASC
      `, [closeoutAggId]);

      const state = createInitialCycleCloseoutState(request.grantCycleId);
      for (const row of eventRows.rows) {
        const event = {
          eventType: row.event_type,
          eventData: row.event_data,
          ingestedAt: row.ingested_at,
        };
        applyCycleCloseoutEvent(state, event);
      }

      const canClose = canCloseout(state);
      if (!canClose.allowed) {
        throw new Error(canClose.reason);
      }

      const finalBalance = state.financialSummary?.unspentCents || Money.fromBigInt(0n);

      // Emit GRANT_CYCLE_CLOSED
      const closeoutAggregateId = GrantCycleCloseout.createAggregateId(request.grantCycleId);

      const closedEvent: Omit<DomainEvent, 'ingestedAt'> = {
        eventId: EventStore.newEventId(),
        aggregateType: 'GRANT_CYCLE_CLOSEOUT',
        aggregateId: closeoutAggregateId,
        eventType: 'GRANT_CYCLE_CLOSED',
        eventData: {
          grantCycleId: request.grantCycleId,
          closedByActorId: request.actorId,
          finalBalanceCents: finalBalance.toString(),
        },
        occurredAt: new Date(),
        grantCycleId: request.grantCycleId,
        correlationId: request.correlationId,
        causationId: null,
        actorId: request.actorId as ActorId,
        actorType: request.actorType,
      };
      await this.store.append(closedEvent);

      await this.updateCloseoutProjection(client, request.grantCycleId);

      await client.query('COMMIT');
      return { status: 'CLOSED' };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async auditHold(request: {
    idempotencyKey: string;
    grantCycleId: string;
    reason: string;
    actorId: string;
    actorType: 'ADMIN';
    correlationId: string;
  }): Promise<{ status: string }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const closeoutAggregateId = GrantCycleCloseout.createAggregateId(request.grantCycleId);

      const holdEvent: Omit<DomainEvent, 'ingestedAt'> = {
        eventId: EventStore.newEventId(),
        aggregateType: 'GRANT_CYCLE_CLOSEOUT',
        aggregateId: closeoutAggregateId,
        eventType: 'GRANT_CYCLE_CLOSEOUT_AUDIT_HOLD',
        eventData: {
          grantCycleId: request.grantCycleId,
          reason: request.reason,
          initiatedByActorId: request.actorId,
        },
        occurredAt: new Date(),
        grantCycleId: request.grantCycleId,
        correlationId: request.correlationId,
        causationId: null,
        actorId: request.actorId as ActorId,
        actorType: request.actorType,
      };
      await this.store.append(holdEvent);

      await this.updateCloseoutProjection(client, request.grantCycleId);

      await client.query('COMMIT');
      return { status: 'AUDIT_HOLD' };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async auditResolve(request: {
    idempotencyKey: string;
    grantCycleId: string;
    resolution: string;
    actorId: string;
    actorType: 'ADMIN';
    correlationId: string;
  }): Promise<{ status: string }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const closeoutAggregateId = GrantCycleCloseout.createAggregateId(request.grantCycleId);

      const resolvedEvent: Omit<DomainEvent, 'ingestedAt'> = {
        eventId: EventStore.newEventId(),
        aggregateType: 'GRANT_CYCLE_CLOSEOUT',
        aggregateId: closeoutAggregateId,
        eventType: 'GRANT_CYCLE_CLOSEOUT_AUDIT_RESOLVED',
        eventData: {
          grantCycleId: request.grantCycleId,
          resolution: request.resolution,
          resolvedByActorId: request.actorId,
        },
        occurredAt: new Date(),
        grantCycleId: request.grantCycleId,
        correlationId: request.correlationId,
        causationId: null,
        actorId: request.actorId as ActorId,
        actorType: request.actorType,
      };
      await this.store.append(resolvedEvent);

      await this.updateCloseoutProjection(client, request.grantCycleId);

      await client.query('COMMIT');
      return { status: 'RECONCILED' };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async updateCloseoutProjection(client: PoolClient, grantCycleId: string): Promise<void> {
    const closeoutAggId = GrantCycleCloseout.createAggregateId(grantCycleId);
    const eventRows = await client.query(`
      SELECT event_id, event_type, event_data, ingested_at
      FROM event_log
      WHERE aggregate_id = $1 AND aggregate_type = 'GRANT_CYCLE_CLOSEOUT'
      ORDER BY ingested_at ASC, event_id ASC
    `, [closeoutAggId]);

    const state = createInitialCycleCloseoutState(grantCycleId);
    for (const row of eventRows.rows) {
      const event = {
        eventType: row.event_type,
        eventData: row.event_data,
        ingestedAt: row.ingested_at,
      };
      applyCycleCloseoutEvent(state, event);
    }
    checkCycleCloseoutInvariant(state);

    await client.query(`
      INSERT INTO grant_cycle_closeout_projection (
        grant_cycle_id, closeout_status, preflight_status, preflight_checks,
        started_at, reconciled_at, financial_summary, matching_funds, activity_summary,
        reconciliation_watermark_ingested_at, reconciliation_watermark_event_id,
        closed_at, closed_by_actor_id, final_balance_cents,
        audit_hold_reason, audit_hold_at, audit_resolved_at, audit_resolution,
        rebuilt_at, watermark_ingested_at, watermark_event_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
      ON CONFLICT (grant_cycle_id) DO UPDATE SET
        closeout_status = EXCLUDED.closeout_status,
        preflight_status = EXCLUDED.preflight_status,
        preflight_checks = EXCLUDED.preflight_checks,
        started_at = EXCLUDED.started_at,
        reconciled_at = EXCLUDED.reconciled_at,
        financial_summary = EXCLUDED.financial_summary,
        matching_funds = EXCLUDED.matching_funds,
        activity_summary = EXCLUDED.activity_summary,
        reconciliation_watermark_ingested_at = EXCLUDED.reconciliation_watermark_ingested_at,
        reconciliation_watermark_event_id = EXCLUDED.reconciliation_watermark_event_id,
        closed_at = EXCLUDED.closed_at,
        closed_by_actor_id = EXCLUDED.closed_by_actor_id,
        final_balance_cents = EXCLUDED.final_balance_cents,
        audit_hold_reason = EXCLUDED.audit_hold_reason,
        audit_hold_at = EXCLUDED.audit_hold_at,
        audit_resolved_at = EXCLUDED.audit_resolved_at,
        audit_resolution = EXCLUDED.audit_resolution,
        rebuilt_at = EXCLUDED.rebuilt_at,
        watermark_ingested_at = EXCLUDED.watermark_ingested_at,
        watermark_event_id = EXCLUDED.watermark_event_id
    `, [
      state.grantCycleId, state.closeoutStatus, state.preflightStatus, JSON.stringify(state.preflightChecks),
      state.startedAt, state.reconciledAt,
      state.financialSummary ? JSON.stringify({
        awardedCents: state.financialSummary.awardedCents.toString(),
        encumberedCents: state.financialSummary.encumberedCents.toString(),
        liquidatedCents: state.financialSummary.liquidatedCents.toString(),
        releasedCents: state.financialSummary.releasedCents.toString(),
        unspentCents: state.financialSummary.unspentCents.toString(),
      }) : null,
      state.matchingFunds ? JSON.stringify({
        committedCents: state.matchingFunds.committedCents.toString(),
        reportedCents: state.matchingFunds.reportedCents.toString(),
        shortfallCents: state.matchingFunds.shortfallCents.toString(),
        surplusCents: state.matchingFunds.surplusCents.toString(),
        evidenceArtifactIds: state.matchingFunds.evidenceArtifactIds,
      }) : null,
      state.activitySummary ? JSON.stringify(state.activitySummary) : null,
      state.reconciliationWatermarkIngestedAt, state.reconciliationWatermarkEventId,
      state.closedAt, state.closedByActorId, state.finalBalanceCents ? state.finalBalanceCents.toString() : null,
      state.auditHoldReason, state.auditHoldAt, state.auditResolvedAt, state.auditResolution,
      new Date(), eventRows.rows[eventRows.rows.length - 1]?.ingested_at || new Date(), eventRows.rows[eventRows.rows.length - 1]?.event_id || crypto.randomUUID()
    ]);
  }

  async isCycleClosed(grantCycleId: string): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        'SELECT closeout_status FROM grant_cycle_closeout_projection WHERE grant_cycle_id = $1',
        [grantCycleId]
      );
      return result.rows.length > 0 && result.rows[0].closeout_status === 'CLOSED';
    } finally {
      client.release();
    }
  }
}
