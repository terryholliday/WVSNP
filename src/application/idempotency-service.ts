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

    const sql = `
      INSERT INTO idempotency_cache (
        idempotency_key, operation_type, request_hash, status, expires_at
      ) VALUES ($1, $2, $3, 'PROCESSING', $4)
      ON CONFLICT (idempotency_key) DO UPDATE SET
        status = CASE
          WHEN idempotency_cache.status = 'COMPLETED' THEN 'COMPLETED'
          WHEN idempotency_cache.status = 'FAILED' THEN 'NEW'::varchar(20)
          ELSE 'PROCESSING'
        END,
        recorded_at = CASE WHEN idempotency_cache.status = 'COMPLETED' THEN idempotency_cache.recorded_at ELSE clock_timestamp() END
      RETURNING status, (xmax = 0) AS inserted
    `;

    const result = await client.query(sql, [key, operationType, requestHash, expiresAt]);
    if (result.rows[0].inserted) {
      return 'NEW';
    }
    return result.rows[0].status as IdempotencyStatus;
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
