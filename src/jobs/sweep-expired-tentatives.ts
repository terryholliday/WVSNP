import { Pool, PoolClient } from 'pg';
import * as crypto from 'crypto';
import { EventStore, DomainEvent } from '../event-store';
import { ActorId } from '../domain-types';

const SYSTEM_ACTOR_ID = '00000000-0000-0000-0000-000000000000' as ActorId;

export async function sweepExpiredTentatives(pool: Pool, store: EventStore): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const sweepCorrelationId = crypto.randomUUID();

    const expiredRows = await client.query(`
      SELECT voucher_id, grant_id, max_reimbursement_cents
      FROM vouchers_projection
      WHERE status = 'TENTATIVE'
        AND tentative_expires_at < NOW()
      FOR UPDATE
    `);

    for (const row of expiredRows.rows) {
      const voucherId = row.voucher_id;
      const grantId = row.grant_id;
      const maxReimbursementCents = BigInt(row.max_reimbursement_cents);

      // Double-check status after lock
      const checkRow = await client.query('SELECT status FROM vouchers_projection WHERE voucher_id = $1', [voucherId]);
      if (checkRow.rows.length === 0 || checkRow.rows[0].status !== 'TENTATIVE') continue;

      const causationRow = await client.query(
        `SELECT event_id, grant_cycle_id
         FROM event_log
         WHERE aggregate_id = $1
           AND event_type = 'VOUCHER_ISSUED_TENTATIVE'
         ORDER BY ingested_at DESC, event_id DESC
         LIMIT 1`,
        [voucherId]
      );
      const causationId = causationRow.rows[0]?.event_id ?? null;
      const grantCycleId = causationRow.rows[0]?.grant_cycle_id;
      if (!grantCycleId) {
        throw new Error('GRANT_CYCLE_ID_NOT_FOUND_FOR_TENTATIVE_VOUCHER');
      }

      // Emit rejection event
      const event: Omit<DomainEvent, 'ingestedAt'> = {
        eventId: EventStore.newEventId(),
        aggregateType: 'VOUCHER',
        aggregateId: voucherId,
        eventType: 'VOUCHER_ISSUED_REJECTED',
        eventData: {
          reason: 'TENTATIVE_EXPIRED',
        },
        occurredAt: new Date(),
        grantCycleId,
        correlationId: sweepCorrelationId,
        causationId,
        actorId: SYSTEM_ACTOR_ID,
        actorType: 'SYSTEM',
      };

      await store.appendWithClient(client, event);

      // Update projection
      await client.query('UPDATE vouchers_projection SET status = $1 WHERE voucher_id = $2', ['VOIDED', voucherId]);
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
