import { Pool } from 'pg';

/**
 * Cleans test tables using DELETE instead of TRUNCATE.
 *
 * TRUNCATE requires ACCESS EXCLUSIVE lock which deadlocks with autovacuum.
 * DELETE only requires ROW EXCLUSIVE — no conflict with autovacuum, ever.
 *
 * Uses session_replication_role = 'replica' to temporarily disable FK checks
 * and immutability triggers so we can DELETE from any table in any order.
 */
export async function truncateWithRetry(
  pool: Pool,
  tables: string
): Promise<void> {
  const tableList = tables.split(',').map((t) => t.trim());
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL session_replication_role = 'replica'");
    for (const table of tableList) {
      await client.query(`DELETE FROM ${table}`);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
