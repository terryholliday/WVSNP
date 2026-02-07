import { Pool } from 'pg';

/**
 * Cleans test tables using DELETE instead of TRUNCATE.
 *
 * TRUNCATE requires ACCESS EXCLUSIVE lock which deadlocks with autovacuum.
 * DELETE only requires ROW EXCLUSIVE — no conflict with autovacuum, ever.
 *
 * Uses session_replication_role = 'replica' to temporarily disable FK checks
 * and immutability triggers so we can DELETE from any table in any order.
 *
 * If the DELETE hangs (orphaned connections from crashed test runs), we
 * terminate blocking backends and retry.
 */
export async function truncateWithRetry(
  pool: Pool,
  tables: string
): Promise<void> {
  const tableList = tables.split(',').map((t) => t.trim());

  for (let attempt = 0; attempt < 3; attempt++) {
    const client = await pool.connect();
    try {
      // Set a statement timeout so we fail fast instead of hanging forever
      await client.query("SET statement_timeout = '5s'");
      await client.query('BEGIN');
      await client.query("SET LOCAL session_replication_role = 'replica'");
      for (const table of tableList) {
        await client.query(`DELETE FROM ${table}`);
      }
      await client.query('COMMIT');
      return;
    } catch (err: any) {
      await client.query('ROLLBACK').catch(() => {});

      const isTimeout = err?.code === '57014';   // statement_timeout
      const isDeadlock = err?.code === '40P01';   // deadlock_detected
      const isLockFail = err?.code === '55P03';   // lock_not_available

      if ((isTimeout || isDeadlock || isLockFail) && attempt < 2) {
        // Kill orphaned backends blocking us, then retry
        await pool.query(`
          SELECT pg_terminate_backend(pid)
          FROM pg_stat_activity
          WHERE datname = current_database()
            AND pid <> pg_backend_pid()
            AND state <> 'idle'
            AND query NOT LIKE '%pg_terminate_backend%'
        `).catch(() => {});
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        continue;
      }
      throw err;
    } finally {
      client.release();
    }
  }
}
