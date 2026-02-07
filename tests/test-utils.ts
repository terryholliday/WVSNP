import { Pool } from 'pg';

/**
 * Executes a TRUNCATE statement with retry logic for deadlock and lock-timeout errors.
 *
 * Uses a dedicated client with a short lock_timeout so TRUNCATE fails fast
 * instead of waiting indefinitely for ACCESS EXCLUSIVE (which conflicts with autovacuum).
 *
 * Retryable error codes:
 *   40P01 = deadlock_detected
 *   55P03 = lock_not_available (lock_timeout exceeded)
 */
export async function truncateWithRetry(
  pool: Pool,
  tables: string,
  maxRetries = 5
): Promise<void> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const client = await pool.connect();
    try {
      await client.query("SET lock_timeout = '3s'");
      await client.query(`TRUNCATE ${tables} CASCADE`);
      return;
    } catch (err: any) {
      const isRetryable = err?.code === '40P01' || err?.code === '55P03';
      if (!isRetryable || attempt === maxRetries) {
        throw err;
      }
      const delayMs = 200 * Math.pow(2, attempt); // 200, 400, 800, 1600, 3200ms
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    } finally {
      client.release();
    }
  }
}
