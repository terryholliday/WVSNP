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

  test('public registry returns license projection without PII fields', async () => {
    const licenseId = '11111111-1111-7111-8111-111111111111';
    await pool.query(
      `INSERT INTO event_log (
        event_id, aggregate_type, aggregate_id, event_type, event_data,
        occurred_at, ingested_at, grant_cycle_id, correlation_id, causation_id,
        actor_id, actor_type
      ) VALUES (
        '018f0b63-0000-7000-8000-000000000101',
        'LICENSE',
        $1::uuid,
        'BREEDER_LICENSED',
        $2::jsonb,
        NOW(),
        NOW(),
        'BARKWV',
        '11111111-1111-4111-8111-111111111111'::uuid,
        NULL,
        '11111111-1111-4111-8111-222222222222'::uuid,
        'SYSTEM'
      )`,
      [
        licenseId,
        JSON.stringify({
          licenseNumber: 'BR-2026-0001',
          licenseType: 'BREEDER',
          county: 'KANAWHA',
          activeFrom: '2026-01-01T00:00:00.000Z',
          expiresOn: '2026-12-31T23:59:59.000Z',
          inspectionGrade: 'A',
          enforcementActions: 0,
          contactName: 'SHOULD_NOT_SURFACE',
        }),
      ]
    );

    const res = await fetch(`${baseUrl}/api/v1/public/registry/licenses?q=BR-2026-0001`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(1);
    expect(body.items[0].licenseId).toBe(licenseId);
    expect(body.items[0].licenseNumber).toBe('BR-2026-0001');
    expect(body.items[0].inspectionGrade).toBe('A');
    expect(body.items[0].contactName).toBeUndefined();
  });

  test('single verify returns signed token and emits verification events', async () => {
    const licenseId = '22222222-2222-7222-8222-222222222222';
    await pool.query(
      `INSERT INTO event_log (
        event_id, aggregate_type, aggregate_id, event_type, event_data,
        occurred_at, ingested_at, grant_cycle_id, correlation_id, causation_id,
        actor_id, actor_type
      ) VALUES (
        '018f0b63-0000-7000-8000-000000000102',
        'LICENSE',
        $1::uuid,
        'TRANSPORTER_LICENSED',
        $2::jsonb,
        NOW(),
        NOW(),
        'BARKWV',
        '22222222-2222-4222-8222-222222222222'::uuid,
        NULL,
        '22222222-2222-4222-8222-333333333333'::uuid,
        'SYSTEM'
      )`,
      [
        licenseId,
        JSON.stringify({
          licenseNumber: 'TR-2026-0009',
          licenseType: 'TRANSPORTER',
          county: 'CABELL',
          expiresOn: '2026-12-31T23:59:59.000Z',
        }),
      ]
    );

    const res = await fetch(`${baseUrl}/api/v1/public/verify/${licenseId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.licenseId).toBe(licenseId);
    expect(body.status).toBe('ACTIVE');
    expect(typeof body.signedToken).toBe('string');

    const eventRows = await pool.query(
      `SELECT event_type FROM event_log
       WHERE aggregate_id = $1::uuid
         AND event_type IN ('LICENSE_VERIFICATION_TOKEN_ISSUED', 'LICENSE_VERIFICATION_PERFORMED')
       ORDER BY ingested_at ASC`,
      [licenseId]
    );
    expect(eventRows.rows.map((row) => row.event_type)).toEqual([
      'LICENSE_VERIFICATION_TOKEN_ISSUED',
      'LICENSE_VERIFICATION_PERFORMED',
    ]);
  });

  test('QR contract endpoint serves JSON and records human verification event', async () => {
    const licenseId = '33333333-3333-7333-8333-333333333333';
    await pool.query(
      `INSERT INTO event_log (
        event_id, aggregate_type, aggregate_id, event_type, event_data,
        occurred_at, ingested_at, grant_cycle_id, correlation_id, causation_id,
        actor_id, actor_type
      ) VALUES (
        '018f0b63-0000-7000-8000-000000000103',
        'LICENSE',
        $1::uuid,
        'BREEDER_LICENSE_STATUS_CHANGED',
        $2::jsonb,
        NOW(),
        NOW(),
        'BARKWV',
        '33333333-3333-4333-8333-333333333333'::uuid,
        '33333333-3333-4333-8333-444444444444'::uuid,
        '33333333-3333-4333-8333-555555555555'::uuid,
        'ADMIN'
      )`,
      [
        licenseId,
        JSON.stringify({
          previousStatus: 'ACTIVE',
          newStatus: 'SUSPENDED',
          reason: 'Inspection hold',
          licenseNumber: 'BR-2026-0019',
          county: 'MONONGALIA',
        }),
      ]
    );

    const res = await fetch(`${baseUrl}/api/v1/public/v1/l/${licenseId}`, {
      headers: { Accept: 'application/json' },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.licenseId).toBe(licenseId);
    expect(body.status).toBe('SUSPENDED');

    const verifyEvent = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM event_log
       WHERE aggregate_id = $1::uuid
         AND event_type = 'LICENSE_VERIFICATION_PERFORMED'
         AND event_data->>'verifierType' = 'HUMAN'`,
      [licenseId]
    );
    expect(verifyEvent.rows[0].count).toBe(1);
  });

  test('batch verify emits marketplace batch event and per-license verification events', async () => {
    const licenseA = '44444444-4444-7444-8444-444444444444';
    const licenseB = '55555555-5555-7555-8555-555555555555';

    await pool.query(
      `INSERT INTO event_log (
        event_id, aggregate_type, aggregate_id, event_type, event_data,
        occurred_at, ingested_at, grant_cycle_id, correlation_id, causation_id,
        actor_id, actor_type
      ) VALUES
      (
        '018f0b63-0000-7000-8000-000000000104',
        'LICENSE',
        $1::uuid,
        'BREEDER_LICENSED',
        '{"licenseNumber":"BR-2026-0301","county":"KANAWHA"}'::jsonb,
        NOW(), NOW(), 'BARKWV',
        '44444444-4444-4444-8444-444444444444'::uuid,
        NULL,
        '44444444-4444-4444-8444-555555555555'::uuid,
        'SYSTEM'
      ),
      (
        '018f0b63-0000-7000-8000-000000000105',
        'LICENSE',
        $2::uuid,
        'TRANSPORTER_LICENSED',
        '{"licenseNumber":"TR-2026-0901","county":"CABELL"}'::jsonb,
        NOW(), NOW(), 'BARKWV',
        '55555555-5555-4555-8555-555555555555'::uuid,
        NULL,
        '55555555-5555-4555-8555-666666666666'::uuid,
        'SYSTEM'
      )`,
      [licenseA, licenseB]
    );

    const res = await fetch(`${baseUrl}/api/v1/public/verify/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        partnerId: 'partner-001',
        licenseIds: [licenseA, licenseB],
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results).toHaveLength(2);
    expect(body.results.every((item: any) => item.found)).toBe(true);

    const batchEvent = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM event_log
       WHERE event_type = 'MARKETPLACE_BATCH_VERIFICATION_PERFORMED'
         AND event_data->>'partnerId' = 'partner-001'`
    );
    expect(batchEvent.rows[0].count).toBe(1);

    const perLicenseEvents = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM event_log
       WHERE event_type = 'LICENSE_VERIFICATION_PERFORMED'
         AND event_data->>'verifierType' = 'BATCH'
         AND (event_data->>'licenseId' = $1 OR event_data->>'licenseId' = $2)`,
      [licenseA, licenseB]
    );
    expect(perLicenseEvents.rows[0].count).toBe(2);
  });

  test('transparency snapshot publish stores immutable artifact and emits hash anchor event', async () => {
    process.env.BARK_TRANSPARENCY_ADMIN_KEY = 'test-admin-key';

    const res = await fetch(`${baseUrl}/api/v1/public/transparency/snapshots/publish`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-wvda-admin-key': 'test-admin-key',
      },
      body: JSON.stringify({ snapshotPeriod: '2026-02' }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.artifactId).toBeDefined();
    expect(body.contentHash).toMatch(/^[0-9a-f]{64}$/);

    const artifactRes = await fetch(`${baseUrl}/api/v1/public/transparency/artifacts/${body.artifactId}`);
    expect(artifactRes.status).toBe(200);
    expect(artifactRes.headers.get('x-content-sha256')).toBe(body.contentHash);
    const artifactBody = await artifactRes.json();
    expect(artifactBody.snapshotPeriod).toBe('2026-02');

    const hashAnchoredEvents = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM event_log
       WHERE aggregate_id = $1::uuid
         AND event_type = 'TRANSPARENCY_ARTIFACT_HASH_ANCHORED'`,
      [body.artifactId]
    );
    expect(hashAnchoredEvents.rows[0].count).toBe(1);
  });
});
