import { Pool } from 'pg';

/**
 * Executes a TRUNCATE statement with retry logic for deadlock errors.
 * PostgreSQL error code 40P01 = deadlock_detected.
 * Retries up to `maxRetries` times with exponential backoff.
 */
export async function truncateWithRetry(
  pool: Pool,
  tables: string,
  maxRetries = 4
): Promise<void> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      await pool.query(`TRUNCATE ${tables} CASCADE`);
      return;
    } catch (err: any) {
      const isDeadlock = err?.code === '40P01';
      if (!isDeadlock || attempt === maxRetries) {
        throw err;
      }
      const delayMs = 100 * Math.pow(2, attempt); // 100, 200, 400, 800ms
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}
