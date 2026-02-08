import { Pool } from 'pg';

export default async function globalSetup() {
  const dbHost = process.env.DB_HOST || 'localhost';
  const dbPort = parseInt(process.env.DB_PORT || '5433', 10);
  const dbUser = process.env.DB_USER || 'postgres';
  const dbPassword = process.env.DB_PASSWORD || 'postgres';

  // Connect to the postgres admin database to kill stale connections
  const adminPool = new Pool({
    host: dbHost,
    port: dbPort,
    database: 'postgres',
    user: dbUser,
    password: dbPassword,
    max: 1,
  });

  try {
    // Kill all connections to wvsnp_test (from previous test runs)
    const result = await adminPool.query(`
      SELECT pg_terminate_backend(pid)
      FROM pg_stat_activity
      WHERE datname = 'wvsnp_test'
        AND pid <> pg_backend_pid()
        AND state IS NOT NULL
    `);
    const killed = result.rowCount ?? 0;
    if (killed > 0) {
      console.log(`[globalSetup] Terminated ${killed} stale connections to wvsnp_test`);
    }

    // Also kill connections to wvsnp_api_e2e
    const result2 = await adminPool.query(`
      SELECT pg_terminate_backend(pid)
      FROM pg_stat_activity
      WHERE datname = 'wvsnp_api_e2e'
        AND pid <> pg_backend_pid()
        AND state IS NOT NULL
    `);
    const killed2 = result2.rowCount ?? 0;
    if (killed2 > 0) {
      console.log(`[globalSetup] Terminated ${killed2} stale connections to wvsnp_api_e2e`);
    }

    // Brief pause to let PostgreSQL fully release resources
    await new Promise(resolve => setTimeout(resolve, 500));
  } finally {
    await adminPool.end();
  }
}
