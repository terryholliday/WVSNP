import { Pool, PoolClient } from 'pg';
import { EventStore, DomainEvent } from '../event-store';
import { IdempotencyService } from './idempotency-service';
import { GrantId, VoucherId, MoneyCents, Allocator, ActorId } from '../domain-types';
import { applyGrantEvent, GrantState, checkGrantInvariant, createInitialGrantState } from '../domain/grant/grant-logic';
import { applyVoucherEvent, VoucherState, checkVoucherInvariant, createInitialVoucherState } from '../domain/voucher/voucher-logic';
import { applyAllocatorEvent, AllocatorState, checkAllocatorInvariant, generateVoucherCode, createInitialAllocatorState } from '../domain/voucher/voucher-code-allocator';

export class GrantService {
  constructor(private pool: Pool, private store: EventStore, private idempotency: IdempotencyService) {}

  async issueVoucherOnline(request: {
    idempotencyKey: string;
    grantId: GrantId;
    voucherId: VoucherId;
    maxReimbursementCents: MoneyCents;
    isLIRP: boolean;
    recipientType: string;
    recipientName: string;
    animalType: string;
    procedureType: string;
    expiresAt: Date;
    coPayRequired: boolean;
    coPayAmountCents?: MoneyCents;
    actorId: string;
    actorType: 'APPLICANT' | 'ADMIN' | 'SYSTEM';
    correlationId: string;
    causationId?: string;
  }): Promise<{ voucherCode: string }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const status = await this.idempotency.checkAndReserve(client, request.idempotencyKey, 'ISSUE_VOUCHER_ONLINE', 'hash', 86400);
      if (status === 'COMPLETED') {
        // Return stored response
        const result = await client.query('SELECT response_json FROM idempotency_cache WHERE idempotency_key = $1', [request.idempotencyKey]);
        return result.rows[0].response_json;
      }
      if (status === 'PROCESSING') {
        throw new Error('OPERATION_IN_PROGRESS');
      }

      const grantCycleId = await this.getGrantCycleId(client, request.grantId);

      // Phase 4: Check if grant period has ended (deadline enforcement)
      const periodEnded = await client.query(
        `SELECT COUNT(*) as count FROM event_log 
         WHERE event_type = 'GRANT_PERIOD_ENDED' AND grant_cycle_id = $1`,
        [grantCycleId]
      );
      if (parseInt(periodEnded.rows[0].count) > 0) {
        throw new Error('GRANT_PERIOD_ENDED');
      }

      if (request.isLIRP && (request.coPayRequired || (request.coPayAmountCents && request.coPayAmountCents > 0n))) {
        throw new Error('LIRP_COPAY_FORBIDDEN');
      }

      // Lock order: Voucher (new), Grant Bucket, Allocator
      // Since voucher is new, lock grant first
      const bucket = request.isLIRP ? 'LIRP' : 'GENERAL';
      await client.query('SELECT 1 FROM grant_balances_projection WHERE grant_id = $1 AND bucket_type = $2 FOR UPDATE', [request.grantId, bucket]);

      // Check funds
      const grantRow = await client.query('SELECT available_cents FROM grant_balances_projection WHERE grant_id = $1 AND bucket_type = $2', [request.grantId, bucket]);
      const availableCents = BigInt(grantRow.rows[0].available_cents);
      if (availableCents < request.maxReimbursementCents) {
        throw new Error('INSUFFICIENT_FUNDS');
      }

      // Get allocator
      const allocatorId = Allocator.createId(grantCycleId, 'COUNTY'); // Assume county from somewhere
      await client.query('SELECT 1 FROM allocators_projection WHERE allocator_id = $1 FOR UPDATE', [allocatorId]);

      // Allocate code
      const allocatorRow = await client.query('SELECT next_sequence FROM allocators_projection WHERE allocator_id = $1', [allocatorId]);
      const sequence = allocatorRow.rows[0].next_sequence;
      const voucherCode = generateVoucherCode('FY2026', 'COUNTY', sequence, '2026');

      // Emit events
      const events: Omit<DomainEvent, 'ingestedAt'>[] = [
        {
          eventId: EventStore.newEventId(),
          aggregateType: 'VOUCHER',
          aggregateId: request.voucherId,
          eventType: 'VOUCHER_ISSUED',
          eventData: {
            voucherCode,
            recipientType: request.recipientType,
            recipientName: request.recipientName,
            animalType: request.animalType,
            procedureType: request.procedureType,
            maxReimbursementCents: request.maxReimbursementCents.toString(),
            expiresAt: request.expiresAt.toISOString(),
            isLIRP: request.isLIRP,
            coPayRequired: request.coPayRequired,
            coPayAmountCents: request.coPayAmountCents?.toString(),
          },
          occurredAt: new Date(),
          grantCycleId,
          correlationId: request.correlationId,
          causationId: request.causationId ?? null,
          actorId: request.actorId as ActorId,
          actorType: request.actorType,
        },
        {
          eventId: EventStore.newEventId(),
          aggregateType: 'GRANT',
          aggregateId: request.grantId,
          eventType: 'GRANT_FUNDS_ENCUMBERED',
          eventData: {
            voucherId: request.voucherId,
            amountCents: request.maxReimbursementCents.toString(),
            isLIRP: request.isLIRP,
          },
          occurredAt: new Date(),
          grantCycleId,
          correlationId: request.correlationId,
          causationId: request.causationId ?? null,
          actorId: request.actorId as ActorId,
          actorType: request.actorType,
        },
        {
          eventId: EventStore.newEventId(),
          aggregateType: 'ALLOCATOR',
          aggregateId: allocatorId,
          eventType: 'VOUCHER_CODE_ALLOCATED',
          eventData: {
            voucherCode,
          },
          occurredAt: new Date(),
          grantCycleId,
          correlationId: request.correlationId,
          causationId: request.causationId ?? null,
          actorId: request.actorId as ActorId,
          actorType: request.actorType,
        },
      ];

      for (const event of events) {
        const appended = await this.store.append(event);
        // Update projections here, but since store.append already does, wait no, store.append only inserts event, projections updated separately in command.

        // For simplicity, update projections after events.

      }

      // Update projections
      await this.updateGrantProjection(client, request.grantId, bucket);
      await this.updateVoucherProjection(client, request.voucherId);
      await this.updateAllocatorProjection(client, allocatorId);

      const response = { voucherCode };
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

  async confirmTentativeVoucher(request: {
    idempotencyKey: string;
    voucherId: VoucherId;
    grantId: GrantId;
    confirmedAt: Date;
    actorId: string;
    actorType: 'APPLICANT' | 'ADMIN' | 'SYSTEM';
    correlationId: string;
    causationId?: string;
  }): Promise<{ voucherCode: string }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const status = await this.idempotency.checkAndReserve(client, request.idempotencyKey, 'CONFIRM_TENTATIVE_VOUCHER', 'hash', 86400);
      if (status === 'COMPLETED') {
        const result = await client.query('SELECT response_json FROM idempotency_cache WHERE idempotency_key = $1', [request.idempotencyKey]);
        return result.rows[0].response_json;
      }
      if (status === 'PROCESSING') {
        throw new Error('OPERATION_IN_PROGRESS');
      }

      const grantCycleId = await this.getGrantCycleId(client, request.grantId);

      // Lock order: Voucher, Grant Bucket, Allocator
      await client.query('SELECT 1 FROM vouchers_projection WHERE voucher_id = $1 FOR UPDATE', [request.voucherId]);
      const voucherRow = await client.query('SELECT status, max_reimbursement_cents, tentative_expires_at, expires_at, is_lirp FROM vouchers_projection WHERE voucher_id = $1', [request.voucherId]);
      if (voucherRow.rows[0].status !== 'TENTATIVE') {
        throw new Error('VOUCHER_NOT_TENTATIVE');
      }
      if (new Date() > new Date(voucherRow.rows[0].tentative_expires_at)) {
        throw new Error('TENTATIVE_EXPIRED');
      }
      const maxReimbursementCents = BigInt(voucherRow.rows[0].max_reimbursement_cents);
      const expiresAt = voucherRow.rows[0].expires_at ?? voucherRow.rows[0].tentative_expires_at;

      // Determine bucket from voucher
      const bucket = voucherRow.rows[0].is_lirp ? 'LIRP' : 'GENERAL';
      await client.query('SELECT 1 FROM grant_balances_projection WHERE grant_id = $1 AND bucket_type = $2 FOR UPDATE', [request.grantId, bucket]);

      // Check funds
      const grantRow = await client.query('SELECT available_cents FROM grant_balances_projection WHERE grant_id = $1 AND bucket_type = $2', [request.grantId, bucket]);
      const availableCents = BigInt(grantRow.rows[0].available_cents);
      if (availableCents < maxReimbursementCents) {
        throw new Error('INSUFFICIENT_FUNDS');
      }

      // Get allocator
      const allocatorId = Allocator.createId(grantCycleId, 'COUNTY');
      await client.query('SELECT 1 FROM allocators_projection WHERE allocator_id = $1 FOR UPDATE', [allocatorId]);

      const allocatorRow = await client.query('SELECT next_sequence FROM allocators_projection WHERE allocator_id = $1', [allocatorId]);
      const sequence = allocatorRow.rows[0].next_sequence;
      const voucherCode = generateVoucherCode('FY2026', 'COUNTY', sequence, '2026');

      // Emit events
      const events: Omit<DomainEvent, 'ingestedAt'>[] = [
        {
          eventId: EventStore.newEventId(),
          aggregateType: 'VOUCHER',
          aggregateId: request.voucherId,
          eventType: 'VOUCHER_ISSUED_CONFIRMED',
          eventData: {
            voucherCode,
            confirmedAt: request.confirmedAt.toISOString(),
            expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
          },
          occurredAt: new Date(),
          grantCycleId,
          correlationId: request.correlationId,
          causationId: request.causationId ?? null,
          actorId: request.actorId as ActorId,
          actorType: request.actorType,
        },
        {
          eventId: EventStore.newEventId(),
          aggregateType: 'GRANT',
          aggregateId: request.grantId,
          eventType: 'GRANT_FUNDS_ENCUMBERED',
          eventData: {
            voucherId: request.voucherId,
            amountCents: maxReimbursementCents.toString(),
            isLIRP: voucherRow.rows[0].is_lirp,
          },
          occurredAt: new Date(),
          grantCycleId,
          correlationId: request.correlationId,
          causationId: request.causationId ?? null,
          actorId: request.actorId as ActorId,
          actorType: request.actorType,
        },
        {
          eventId: EventStore.newEventId(),
          aggregateType: 'ALLOCATOR',
          aggregateId: allocatorId,
          eventType: 'VOUCHER_CODE_ALLOCATED',
          eventData: {
            voucherCode,
          },
          occurredAt: new Date(),
          grantCycleId,
          correlationId: request.correlationId,
          causationId: request.causationId ?? null,
          actorId: request.actorId as ActorId,
          actorType: request.actorType,
        },
      ];

      for (const event of events) {
        await this.store.append(event);
      }

      // Update projections
      await this.updateGrantProjection(client, request.grantId, bucket);
      await this.updateVoucherProjection(client, request.voucherId);
      await this.updateAllocatorProjection(client, allocatorId);

      const response = { voucherCode };
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

  private async updateGrantProjection(client: PoolClient, grantId: GrantId, bucket: string): Promise<void> {
    const eventRows = await client.query(`
      SELECT event_type, event_data, ingested_at, grant_cycle_id
      FROM event_log
      WHERE aggregate_id = $1
      ORDER BY ingested_at ASC, event_id ASC
    `, [grantId]);

    const grantCycleId = eventRows.rows[0]?.grant_cycle_id;
    const state = createInitialGrantState();
    for (const row of eventRows.rows) {
      const event = {
        eventType: row.event_type,
        eventData: row.event_data,
        ingestedAt: row.ingested_at,
      };
      applyGrantEvent(state, event);
    }
    checkGrantInvariant(state);

    const bucketState = state.get(bucket as 'GENERAL' | 'LIRP');
    if (!bucketState) return;

    await client.query(`
      INSERT INTO grant_balances_projection (
        grant_id, grant_cycle_id, bucket_type, awarded_cents, available_cents, encumbered_cents, liquidated_cents, released_cents,
        rate_numerator_cents, rate_denominator_cents, matching_committed_cents, matching_reported_cents,
        rebuilt_at, watermark_ingested_at, watermark_event_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      ON CONFLICT (grant_id, bucket_type) DO UPDATE SET
        grant_cycle_id = EXCLUDED.grant_cycle_id,
        awarded_cents = EXCLUDED.awarded_cents,
        available_cents = EXCLUDED.available_cents,
        encumbered_cents = EXCLUDED.encumbered_cents,
        liquidated_cents = EXCLUDED.liquidated_cents,
        released_cents = EXCLUDED.released_cents,
        rate_numerator_cents = EXCLUDED.rate_numerator_cents,
        rate_denominator_cents = EXCLUDED.rate_denominator_cents,
        matching_committed_cents = EXCLUDED.matching_committed_cents,
        matching_reported_cents = EXCLUDED.matching_reported_cents,
        rebuilt_at = EXCLUDED.rebuilt_at,
        watermark_ingested_at = EXCLUDED.watermark_ingested_at,
        watermark_event_id = EXCLUDED.watermark_event_id
    `, [
      grantId, grantCycleId, bucket,
      bucketState.awardedCents.toString(), bucketState.availableCents.toString(), bucketState.encumberedCents.toString(), bucketState.liquidatedCents.toString(), bucketState.releasedCents.toString(),
      bucketState.rateNumeratorCents.toString(), bucketState.rateDenominatorCents.toString(),
      bucketState.matchingCommittedCents.toString(), bucketState.matchingReportedCents.toString(),
      new Date(), eventRows.rows[eventRows.rows.length - 1]?.ingested_at || new Date(), eventRows.rows[eventRows.rows.length - 1]?.event_id || EventStore.newEventId()
    ]);
  }

  private async updateVoucherProjection(client: PoolClient, voucherId: VoucherId): Promise<void> {
    const eventRows = await client.query(`
      SELECT event_id, event_type, event_data, ingested_at, grant_cycle_id
      FROM event_log
      WHERE aggregate_id = $1
      ORDER BY ingested_at ASC, event_id ASC
    `, [voucherId]);

    const grantId = (eventRows.rows[0]?.event_data as any)?.grantId || voucherId;
    const state = createInitialVoucherState(voucherId, grantId);
    for (const row of eventRows.rows) {
      const event = {
        eventType: row.event_type,
        eventData: row.event_data,
        ingestedAt: row.ingested_at,
      };
      applyVoucherEvent(state, event);
    }
    checkVoucherInvariant(state);

    await client.query(`
      INSERT INTO vouchers_projection (
        voucher_id, grant_id, voucher_code, county_code, status, max_reimbursement_cents, is_lirp,
        tentative_expires_at, expires_at, issued_at, redeemed_at, expired_at, voided_at,
        rebuilt_at, watermark_ingested_at, watermark_event_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
      ON CONFLICT (voucher_id) DO UPDATE SET
        grant_id = EXCLUDED.grant_id,
        voucher_code = EXCLUDED.voucher_code,
        county_code = EXCLUDED.county_code,
        status = EXCLUDED.status,
        max_reimbursement_cents = EXCLUDED.max_reimbursement_cents,
        is_lirp = EXCLUDED.is_lirp,
        tentative_expires_at = EXCLUDED.tentative_expires_at,
        expires_at = EXCLUDED.expires_at,
        issued_at = EXCLUDED.issued_at,
        redeemed_at = EXCLUDED.redeemed_at,
        expired_at = EXCLUDED.expired_at,
        voided_at = EXCLUDED.voided_at,
        rebuilt_at = EXCLUDED.rebuilt_at,
        watermark_ingested_at = EXCLUDED.watermark_ingested_at,
        watermark_event_id = EXCLUDED.watermark_event_id
    `, [
      state.voucherId, state.grantId, state.voucherCode, null, state.status, state.maxReimbursementCents.toString(), state.isLIRP,
      state.tentativeExpiresAt, state.expiresAt, state.issuedAt, state.redeemedAt, state.expiredAt, state.voidedAt,
      new Date(), eventRows.rows[eventRows.rows.length - 1]?.ingested_at || new Date(), eventRows.rows[eventRows.rows.length - 1]?.event_id || EventStore.newEventId()
    ]);
  }

  private async updateAllocatorProjection(client: PoolClient, allocatorId: string): Promise<void> {
    const eventRows = await client.query(`
      SELECT event_id, event_type, event_data, ingested_at, grant_cycle_id
      FROM event_log
      WHERE aggregate_id = $1
      ORDER BY ingested_at ASC, event_id ASC
    `, [allocatorId]);

    const grantCycleId = eventRows.rows[0]?.grant_cycle_id;
    const state = createInitialAllocatorState(allocatorId as any);
    for (const row of eventRows.rows) {
      const event = {
        eventType: row.event_type,
        eventData: row.event_data,
        ingestedAt: row.ingested_at,
      };
      applyAllocatorEvent(state, event);
    }
    checkAllocatorInvariant(state);

    await client.query(`
      INSERT INTO allocators_projection (
        allocator_id, grant_cycle_id, county_code, next_sequence,
        rebuilt_at, watermark_ingested_at, watermark_event_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (allocator_id) DO UPDATE SET
        grant_cycle_id = EXCLUDED.grant_cycle_id,
        county_code = EXCLUDED.county_code,
        next_sequence = EXCLUDED.next_sequence,
        rebuilt_at = EXCLUDED.rebuilt_at,
        watermark_ingested_at = EXCLUDED.watermark_ingested_at,
        watermark_event_id = EXCLUDED.watermark_event_id
    `, [
      state.allocatorId, grantCycleId, 'COUNTY', state.nextSequence,
      new Date(), eventRows.rows[eventRows.rows.length - 1]?.ingested_at || new Date(), eventRows.rows[eventRows.rows.length - 1]?.event_id || EventStore.newEventId()
    ]);
  }

  private async getGrantCycleId(client: PoolClient, grantId: GrantId): Promise<string> {
    const result = await client.query(
      `SELECT grant_cycle_id
       FROM event_log
       WHERE aggregate_id = $1
         AND aggregate_type = 'GRANT'
       ORDER BY ingested_at ASC, event_id ASC
       LIMIT 1`,
      [grantId]
    );
    if (result.rows.length === 0) {
      throw new Error('GRANT_CYCLE_ID_NOT_FOUND');
    }
    return result.rows[0].grant_cycle_id;
  }
}
