import { Pool } from 'pg';
import { rebuildAllProjections } from './rebuild';

async function main(): Promise<void> {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    await rebuildAllProjections(pool);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
