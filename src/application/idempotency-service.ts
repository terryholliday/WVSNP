import { Pool, PoolClient } from 'pg';

export type IdempotencyStatus = 'NEW' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

export interface IdempotencyRecord {
  idempotencyKey: string;
  operationType: string;
  requestHash: string;
  responseJson: any;
  status: IdempotencyStatus;
  recordedAt: Date;
  expiresAt: Date;
}

export class IdempotencyService {
  constructor(private pool: Pool) {}

  async checkAndReserve(
    client: PoolClient,
    key: string,
    operationType: string,
    requestHash: string,
    ttlSeconds: number = 86400 // 24h
  ): Promise<IdempotencyStatus> {
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

    // Step 1: Lock any existing row to avoid deadlocks from speculative
    //         INSERT ... ON CONFLICT DO UPDATE.
    const existing = await client.query(
      'SELECT status FROM idempotency_cache WHERE idempotency_key = $1 FOR UPDATE',
      [key]
    );

    if (existing.rows.length > 0) {
      const currentStatus = existing.rows[0].status as IdempotencyStatus;

      if (currentStatus === 'COMPLETED') {
        return 'COMPLETED';
      }

      if (currentStatus === 'PROCESSING') {
        return 'PROCESSING';
      }

      // FAILED → allow retry: reset to PROCESSING and return NEW
      if (currentStatus === 'FAILED') {
        await client.query(
          "UPDATE idempotency_cache SET status = 'PROCESSING', recorded_at = clock_timestamp() WHERE idempotency_key = $1",
          [key]
        );
        return 'NEW';
      }
    }

    // Step 2: No existing row → insert fresh reservation
    await client.query(
      "INSERT INTO idempotency_cache (idempotency_key, operation_type, request_hash, status, expires_at) VALUES ($1, $2, $3, 'PROCESSING', $4)",
      [key, operationType, requestHash, expiresAt]
    );
    return 'NEW';
  }

  async recordResult(client: PoolClient, key: string, response: any): Promise<void> {
    const sql = `
      UPDATE idempotency_cache
      SET status = 'COMPLETED', response_json = $2, recorded_at = clock_timestamp()
      WHERE idempotency_key = $1
    `;
    await client.query(sql, [key, JSON.stringify(response)]);
  }

  async recordFailure(client: PoolClient, key: string): Promise<void> {
    const sql = `
      UPDATE idempotency_cache
      SET status = 'FAILED', recorded_at = clock_timestamp()
      WHERE idempotency_key = $1
    `;
    await client.query(sql, [key]);
  }
}
