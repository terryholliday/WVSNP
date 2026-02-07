import { Pool } from 'pg';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { Server } from 'http';

let pool: Pool;
let server: Server;
let baseUrl: string;
let apiPool: { query: Pool['query'] };
let closeApiPool: (() => Promise<void>) | undefined;

describe('API E2E smoke', () => {
  beforeAll(async () => {
    const dbHost = process.env.DB_HOST || 'localhost';
    const dbPort = parseInt(process.env.DB_PORT || '5433', 10);
    const dbName = process.env.DB_NAME || 'wvsnp_api_e2e';
    const dbUser = process.env.DB_USER || 'postgres';
    const dbPassword = process.env.DB_PASSWORD || 'postgres';
    process.env.DATABASE_URL = `postgresql://${dbUser}:${dbPassword}@${dbHost}:${dbPort}/${dbName}`;

    // Create database if it doesn't exist (connect to postgres first)
    const adminPool = new Pool({
      host: dbHost, port: dbPort, database: 'postgres', user: dbUser, password: dbPassword,
    });
    try {
      await adminPool.query(`CREATE DATABASE "${dbName}"`);
    } catch (error: any) {
      // Ignore "database already exists" error
      if (!error.message.includes('already exists')) {
        throw error;
      }
    }
    await adminPool.end();

    // Apply schema FIRST, before starting API server, to avoid pool contention
    const setupPool = new Pool({
      host: dbHost, port: dbPort, database: dbName, user: dbUser, password: dbPassword,
    });
    const schemaPath = join(__dirname, '../../db/schema.sql');
    const schemaSqlRaw = readFileSync(schemaPath, 'utf-8');
    const schemaSql = schemaSqlRaw.replace(/^\uFEFF/, '').replace(/\u200B/g, '');
    await setupPool.query(schemaSql);
    await setupPool.end();

    // Now start API server with clean schema
    const serverModule = await import('../../src/api/server');
    const app = serverModule.default;
    closeApiPool = serverModule.closeApiPool;
    apiPool = serverModule.apiPool;

    // Use the API server's own pool for test queries so there is only one
    // pool holding locks — this eliminates cross-pool deadlocks.
    pool = apiPool as Pool;

    // Use the API server's pool directly for all operations
    // No separate cleanup pool to avoid cross-suite interference

    server = app.listen(0);
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('FAILED_TO_START_SERVER');
    }
    baseUrl = `http://127.0.0.1:${address.port}`;

    const schema = await pool.query(
      "SELECT to_regclass('public.event_log') as event_log, to_regclass('public.vouchers_projection') as vouchers_projection"
    );
    if (!schema.rows[0].event_log) {
      throw new Error('MISSING_SCHEMA: run npm run setup:db against wvsnp_test before running api e2e');
    }
  }, 60_000);

  beforeEach(async () => {
    // Use TRUNCATE with retry mechanism to handle transient lock contention
    const maxRetries = 3;
    const baseDelay = 1000; // 1s
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await pool.query(
          'TRUNCATE event_log, vouchers_projection, idempotency_cache CASCADE'
        );
        return; // Success
      } catch (error: any) {
        if (attempt === maxRetries) {
          throw error; // Re-throw on final attempt
        }
        
        // If it's a lock contention error, wait and retry
        if (error.message.includes('deadlock') || error.message.includes('lock')) {
          await new Promise(resolve => setTimeout(resolve, baseDelay * attempt));
          continue;
        }
        
        // For other errors, don't retry
        throw error;
      }
    }
  }, 30_000);

  afterAll(async () => {
    // Close API server first
    await new Promise<void>((resolve, reject) => {
      if (!server) return resolve();
      server.close((err) => (err ? reject(err) : resolve()));
    });
    
    // Then close the API pool
    if (closeApiPool) {
      await closeApiPool();
    }
    
    // Wait a moment for connections to fully release
    await new Promise(resolve => setTimeout(resolve, 1000));
  });

  test('health endpoint responds', async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
  });

  test('public voucher lookup returns seeded voucher', async () => {
    await pool.query(
      `INSERT INTO vouchers_projection (
        voucher_id, grant_id, voucher_code, county_code, status, max_reimbursement_cents, is_lirp,
        tentative_expires_at, expires_at, issued_at, redeemed_at, expired_at, voided_at,
        rebuilt_at, watermark_ingested_at, watermark_event_id
      ) VALUES (
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        'KANAWHA-20260101-0001',
        'KANAWHA',
        'ISSUED',
        50000,
        false,
        NULL,
        NOW() + interval '90 days',
        NOW(),
        NULL,
        NULL,
        NULL,
        NOW(),
        NOW(),
        gen_random_uuid()
      )`
    );

    const res = await fetch(`${baseUrl}/api/v1/public/vouchers/KANAWHA-20260101-0001`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.voucherCode).toBe('KANAWHA-20260101-0001');
    expect(body.status).toBe('ISSUED');
  });

  test('event_store append stamps ingested_at using server time (trigger)', async () => {
    await pool.query(
      `INSERT INTO event_log (
        event_id, aggregate_type, aggregate_id, event_type, event_data,
        occurred_at, ingested_at,
        grant_cycle_id, correlation_id, causation_id,
        actor_id, actor_type
      ) VALUES (
        gen_random_uuid(),
        'GRANT',
        gen_random_uuid(),
        'GRANT_CREATED',
        '{}'::jsonb,
        NOW() - interval '7 days',
        NOW() - interval '30 days',
        'FY2026',
        gen_random_uuid(),
        NULL,
        gen_random_uuid(),
        'SYSTEM'
      ) RETURNING ingested_at`
    );

    const row = await pool.query(
      `SELECT ingested_at FROM event_log ORDER BY ingested_at DESC LIMIT 1`
    );

    const ingestedAt = new Date(row.rows[0].ingested_at).getTime();
    const now = Date.now();

    expect(now - ingestedAt).toBeLessThan(60_000);
  });

  test('event_log is immutable (update blocked)', async () => {
    const inserted = await pool.query(
      `INSERT INTO event_log (
        event_id, aggregate_type, aggregate_id, event_type, event_data,
        occurred_at, ingested_at,
        grant_cycle_id, correlation_id, causation_id,
        actor_id, actor_type
      ) VALUES (
        gen_random_uuid(),
        'GRANT',
        gen_random_uuid(),
        'GRANT_CREATED',
        '{}'::jsonb,
        NOW(),
        NOW(),
        'FY2026',
        gen_random_uuid(),
        NULL,
        gen_random_uuid(),
        'SYSTEM'
      ) RETURNING event_id`
    );

    await expect(
      pool.query('UPDATE event_log SET event_type = $1 WHERE event_id = $2', [
        'GRANT_CREATED_CORRECTION',
        inserted.rows[0].event_id,
      ])
    ).rejects.toThrow(/immutable/i);
  });
});
