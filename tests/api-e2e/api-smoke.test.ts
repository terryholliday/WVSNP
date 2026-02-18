import { Pool } from 'pg';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { Server } from 'http';
import { createServer } from 'http';
import crypto from 'crypto';

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
          'TRUNCATE event_log, vouchers_projection, idempotency_cache, breeder_compliance_queue_projection, marketplace_partner_api_keys, marketplace_partner_webhooks, marketplace_webhook_deliveries CASCADE'
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
        $2::jsonb,
        NOW(),
        NOW(),
        'BARKWV',
        '44444444-4444-4444-8444-444444444444'::uuid,
        NULL,
        '44444444-4444-4444-8444-555555555555'::uuid,
        'SYSTEM'
      ),
      (
        '018f0b63-0000-7000-8000-000000000105',
        'LICENSE',
        $3::uuid,
        'TRANSPORTER_LICENSED',
        $4::jsonb,
        NOW(),
        NOW(),
        'BARKWV',
        '55555555-5555-4555-8555-555555555555'::uuid,
        NULL,
        '55555555-5555-4555-8555-666666666666'::uuid,
        'SYSTEM'
      )`,
      [
        licenseA,
        JSON.stringify({
          licenseNumber: 'BR-2026-0301',
          county: 'KANAWHA',
          expiresOn: '2026-12-31T23:59:59.000Z',
        }),
        licenseB,
        JSON.stringify({
          licenseNumber: 'TR-2026-0901',
          county: 'CABELL',
          expiresOn: '2026-12-31T23:59:59.000Z',
        }),
      ]
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

  test('marketplace verify-listing returns ALLOW decision with signed assertion and emits listing event', async () => {
    const partnerApiKey = 'wvsnp_marketplace_partner_alpha_test_key';
    const partnerId = 'partner-alpha';
    const licenseId = '66666666-6666-7666-8666-666666666666';
    const keyHash = crypto.createHash('sha256').update(partnerApiKey, 'utf8').digest('hex');

    await pool.query(
      `INSERT INTO marketplace_partner_api_keys (
         key_id, partner_id, key_hash, scopes, webhook_secret, rate_limit_per_minute, expires_at
       ) VALUES (
         'aaaaaaaa-1111-4111-8111-111111111111'::uuid,
         $1,
         $2,
         '["MARKETPLACE_VERIFY"]'::jsonb,
         'partner-alpha-webhook-secret',
         120,
         NOW() + interval '30 days'
       )`,
      [partnerId, keyHash]
    );

    await pool.query(
      `INSERT INTO event_log (
        event_id, aggregate_type, aggregate_id, event_type, event_data,
        occurred_at, ingested_at, grant_cycle_id, correlation_id, causation_id,
        actor_id, actor_type
      ) VALUES (
        '018f0b63-0000-7000-8000-000000000106',
        'LICENSE',
        $1::uuid,
        'BREEDER_LICENSED',
        $2::jsonb,
        NOW(),
        NOW(),
        'BARKWV',
        '66666666-6666-4666-8666-666666666666'::uuid,
        NULL,
        '66666666-6666-4666-8666-777777777777'::uuid,
        'SYSTEM'
      )`,
      [
        licenseId,
        JSON.stringify({
          licenseNumber: 'BR-2026-0666',
          county: 'KANAWHA',
          expiresOn: '2026-12-31T23:59:59.000Z',
        }),
      ]
    );

    const res = await fetch(`${baseUrl}/api/v1/public/marketplace/verify-listing`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${partnerApiKey}`,
      },
      body: JSON.stringify({
        listingId: 'listing-001',
        licenseId,
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.partnerId).toBe(partnerId);
    expect(body.outcome.listingId).toBe('listing-001');
    expect(body.outcome.decision).toBe('ALLOW');
    expect(body.outcome.reasonCodes).toEqual(['LICENSE_ACTIVE']);
    expect(body.outcome.assertion.token).toMatch(/^barkwv-marketplace-v1\./);
    expect(body.replayed).toBe(false);

    const listingEvents = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM event_log
       WHERE event_type = 'MARKETPLACE_LISTING_VERIFIED'
         AND event_data->>'partnerId' = $1
         AND event_data->>'listingId' = 'listing-001'`,
      [partnerId]
    );
    expect(listingEvents.rows[0].count).toBe(1);
  });

  test('marketplace verify-listing idempotency replays response and prevents duplicate events', async () => {
    const partnerApiKey = 'wvsnp_marketplace_partner_beta_test_key';
    const partnerId = 'partner-beta';
    const licenseId = '77777777-7777-7777-8777-777777777777';
    const keyHash = crypto.createHash('sha256').update(partnerApiKey, 'utf8').digest('hex');

    await pool.query(
      `INSERT INTO marketplace_partner_api_keys (
         key_id, partner_id, key_hash, scopes, webhook_secret, rate_limit_per_minute, expires_at
       ) VALUES (
         'bbbbbbbb-2222-4222-8222-222222222222'::uuid,
         $1,
         $2,
         '["MARKETPLACE_VERIFY"]'::jsonb,
         'partner-beta-webhook-secret',
         120,
         NOW() + interval '30 days'
       )`,
      [partnerId, keyHash]
    );

    await pool.query(
      `INSERT INTO event_log (
        event_id, aggregate_type, aggregate_id, event_type, event_data,
        occurred_at, ingested_at, grant_cycle_id, correlation_id, causation_id,
        actor_id, actor_type
      ) VALUES (
        '018f0b63-0000-7000-8000-000000000107',
        'LICENSE',
        $1::uuid,
        'TRANSPORTER_LICENSED',
        '{"licenseNumber":"TR-2026-0701","county":"CABELL","expiresOn":"2026-12-31T23:59:59.000Z"}'::jsonb,
        NOW(), NOW(), 'BARKWV',
        '77777777-7777-4777-8777-777777777777'::uuid,
        NULL,
        '77777777-7777-4777-8777-888888888888'::uuid,
        'SYSTEM'
      )`,
      [licenseId]
    );

    const idempotencyKey = 'idem-marketplace-listing-001';
    const requestBody = {
      listingId: 'listing-dup-001',
      licenseId,
    };

    const first = await fetch(`${baseUrl}/api/v1/public/marketplace/verify-listing`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${partnerApiKey}`,
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify(requestBody),
    });
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    expect(firstBody.replayed).toBe(false);

    const second = await fetch(`${baseUrl}/api/v1/public/marketplace/verify-listing`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${partnerApiKey}`,
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify(requestBody),
    });
    expect(second.status).toBe(200);
    const secondBody = await second.json();
    expect(secondBody.replayed).toBe(true);
    expect(secondBody.outcome.assertion.assertionId).toBe(firstBody.outcome.assertion.assertionId);

    const listingEvents = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM event_log
       WHERE event_type = 'MARKETPLACE_LISTING_VERIFIED'
         AND event_data->>'partnerId' = $1
         AND event_data->>'listingId' = 'listing-dup-001'`,
      [partnerId]
    );
    expect(listingEvents.rows[0].count).toBe(1);
  });

  test('marketplace status drift emits webhook with valid HMAC signature', async () => {
    const partnerApiKey = 'wvsnp_marketplace_partner_gamma_test_key';
    const partnerId = 'partner-gamma';
    const licenseId = '88888888-8888-7888-8888-888888888888';
    const keyHash = crypto.createHash('sha256').update(partnerApiKey, 'utf8').digest('hex');

    await pool.query(
      `INSERT INTO marketplace_partner_api_keys (
         key_id, partner_id, key_hash, scopes, webhook_secret, rate_limit_per_minute, expires_at
       ) VALUES (
         'cccccccc-3333-4333-8333-333333333333'::uuid,
         $1,
         $2,
         '["MARKETPLACE_VERIFY","MARKETPLACE_WEBHOOKS"]'::jsonb,
         'partner-gamma-webhook-secret',
         120,
         NOW() + interval '30 days'
       )`,
      [partnerId, keyHash]
    );

    await pool.query(
      `INSERT INTO event_log (
        event_id, aggregate_type, aggregate_id, event_type, event_data,
        occurred_at, ingested_at, grant_cycle_id, correlation_id, causation_id,
        actor_id, actor_type
      ) VALUES (
        '018f0b63-0000-7000-8000-000000000108',
        'LICENSE',
        $1::uuid,
        'BREEDER_LICENSED',
        '{"licenseNumber":"BR-2026-0888","county":"KANAWHA","expiresOn":"2026-12-31T23:59:59.000Z"}'::jsonb,
        NOW(), NOW(), 'BARKWV',
        '88888888-8888-4888-8888-888888888888'::uuid,
        NULL,
        '88888888-8888-4888-8888-999999999999'::uuid,
        'SYSTEM'
      )`,
      [licenseId]
    );

    let receivedBody = '';
    let receivedHeaders: Record<string, string | string[] | undefined> = {};
    const webhookServer = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      req.on('end', () => {
        receivedBody = Buffer.concat(chunks).toString('utf8');
        receivedHeaders = req.headers;
        res.statusCode = 200;
        res.end('ok');
      });
    });

    await new Promise<void>((resolve) => webhookServer.listen(0, '127.0.0.1', () => resolve()));

    try {
      const address = webhookServer.address();
      if (!address || typeof address === 'string') {
        throw new Error('FAILED_TO_START_WEBHOOK_SERVER');
      }

      const registerRes = await fetch(`${baseUrl}/api/v1/public/marketplace/webhooks/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${partnerApiKey}`,
        },
        body: JSON.stringify({
          callbackUrl: `http://127.0.0.1:${address.port}/hooks/marketplace`,
          eventTypes: ['MARKETPLACE_LICENSE_STATUS_DRIFT_DETECTED'],
        }),
      });
      expect(registerRes.status).toBe(201);
      const registerBody = await registerRes.json();

      const firstVerify = await fetch(`${baseUrl}/api/v1/public/marketplace/verify-listing`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${partnerApiKey}`,
        },
        body: JSON.stringify({
          listingId: 'listing-drift-001',
          licenseId,
        }),
      });
      expect(firstVerify.status).toBe(200);

      await pool.query(
        `INSERT INTO event_log (
          event_id, aggregate_type, aggregate_id, event_type, event_data,
          occurred_at, ingested_at, grant_cycle_id, correlation_id, causation_id,
          actor_id, actor_type
        ) VALUES (
          '018f0b63-0000-7000-8000-000000000109',
          'LICENSE',
          $1::uuid,
          'BREEDER_LICENSE_STATUS_CHANGED',
          '{"previousStatus":"ACTIVE","newStatus":"SUSPENDED","licenseNumber":"BR-2026-0888"}'::jsonb,
          NOW(), NOW(), 'BARKWV',
          '99999999-9999-4999-8999-999999999999'::uuid,
          '99999999-9999-4999-8999-aaaaaaaaaaaa'::uuid,
          '99999999-9999-4999-8999-bbbbbbbbbbbb'::uuid,
          'ADMIN'
        )`,
        [licenseId]
      );

      const driftVerify = await fetch(`${baseUrl}/api/v1/public/marketplace/verify-listing`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${partnerApiKey}`,
        },
        body: JSON.stringify({
          listingId: 'listing-drift-001',
          licenseId,
        }),
      });
      expect(driftVerify.status).toBe(200);
      const driftBody = await driftVerify.json();
      expect(driftBody.outcome.decision).toBe('BLOCK');
      expect(driftBody.outcome.reasonCodes).toContain('LICENSE_SUSPENDED');

      let deliveriesCount = 0;
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const deliveryRows = await pool.query(
          `SELECT COUNT(*)::int AS count
           FROM marketplace_webhook_deliveries
           WHERE partner_id = $1
             AND event_type = 'MARKETPLACE_LICENSE_STATUS_DRIFT_DETECTED'`,
          [partnerId]
        );
        deliveriesCount = deliveryRows.rows[0].count;
        if (deliveriesCount > 0) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect(deliveriesCount).toBe(1);

      const secretRow = await pool.query(
        `SELECT webhook_secret
         FROM marketplace_partner_webhooks
         WHERE subscription_id = $1::uuid`,
        [registerBody.subscriptionId]
      );
      expect(secretRow.rows.length).toBe(1);
      const webhookSecret = secretRow.rows[0].webhook_secret as string;

      const timestamp = String(receivedHeaders['x-marketplace-webhook-timestamp']);
      const signature = String(receivedHeaders['x-marketplace-webhook-signature']);
      const expectedSignature = crypto
        .createHmac('sha256', webhookSecret)
        .update(`${timestamp}.${receivedBody}`, 'utf8')
        .digest('hex');
      expect(signature).toBe(expectedSignature);

      const driftEvents = await pool.query(
        `SELECT COUNT(*)::int AS count
         FROM event_log
         WHERE event_type = 'MARKETPLACE_LICENSE_STATUS_DRIFT_DETECTED'
           AND event_data->>'partnerId' = $1
           AND event_data->>'listingId' = 'listing-drift-001'`,
        [partnerId]
      );
      expect(driftEvents.rows[0].count).toBe(1);
    } finally {
      await new Promise<void>((resolve, reject) => {
        webhookServer.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  test('breeder transfer confirmation filing is idempotent and projects queue status', async () => {
    const licenseId = '91c3717a-6f9d-4f2e-9328-0c0d24f04fd8';
    const occurredAt = new Date('2026-02-15T12:00:00.000Z').toISOString();

    await pool.query(
      `INSERT INTO event_log (
        event_id, aggregate_type, aggregate_id, event_type, event_data,
        occurred_at, ingested_at, grant_cycle_id, correlation_id, causation_id,
        actor_id, actor_type
      ) VALUES (
        '018f0b63-0000-7000-8000-000000000120',
        'LICENSE',
        $1::uuid,
        'BREEDER_LICENSED',
        '{"licenseNumber":"BR-2026-1200","county":"KANAWHA","expiresOn":"2026-12-31T23:59:59.000Z"}'::jsonb,
        NOW(), NOW(), 'BARKWV',
        '7e34deea-173f-4ff5-9f7f-df59f53ea3a1'::uuid,
        NULL,
        'f1fca844-322a-4f69-8e9a-9b43ad08b4de'::uuid,
        'SYSTEM'
      )`,
      [licenseId]
    );

    const requestBody = {
      licenseId,
      occurredAt,
      transferId: 'xfer-0001',
      animalCount: 2,
      notes: 'Initial transfer confirmation',
    };

    const first = await fetch(`${baseUrl}/api/v1/public/breeder/filings/transfer-confirmation`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'idem-breeder-transfer-0001',
      },
      body: JSON.stringify(requestBody),
    });

    expect(first.status).toBe(201);
    const firstBody = await first.json();
    expect(firstBody.replayed).toBe(false);
    expect(firstBody.filing.filingType).toBe('TRANSFER_CONFIRMATION');
    expect(firstBody.filing.filingStatus).toBe('SUBMITTED');

    const second = await fetch(`${baseUrl}/api/v1/public/breeder/filings/transfer-confirmation`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'idem-breeder-transfer-0001',
      },
      body: JSON.stringify(requestBody),
    });

    expect(second.status).toBe(200);
    const secondBody = await second.json();
    expect(secondBody.replayed).toBe(true);
    expect(secondBody.filingId).toBe(firstBody.filingId);

    const eventRows = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM event_log
       WHERE aggregate_type = 'BREEDER_REPORTING'
         AND aggregate_id = $1::uuid
         AND event_type = 'BREEDER_TRANSFER_CONFIRMATION_FILED'`,
      [firstBody.filingId]
    );
    expect(eventRows.rows[0].count).toBe(1);

    const projection = await pool.query(
      `SELECT filing_type, status, submitted_at, amended_at
       FROM breeder_compliance_queue_projection
       WHERE filing_id = $1::uuid`,
      [firstBody.filingId]
    );
    expect(projection.rows.length).toBe(1);
    expect(projection.rows[0].filing_type).toBe('TRANSFER_CONFIRMATION');
    expect(['ON_TIME', 'DUE_SOON']).toContain(projection.rows[0].status);
    expect(projection.rows[0].submitted_at).toBeTruthy();
    expect(projection.rows[0].amended_at).toBeNull();

    const getById = await fetch(`${baseUrl}/api/v1/public/breeder/filings/${firstBody.filingId}`);
    expect(getById.status).toBe(200);
    const getByIdBody = await getById.json();
    expect(getByIdBody.filingId).toBe(firstBody.filingId);
    expect(getByIdBody.filingType).toBe('TRANSFER_CONFIRMATION');

    const list = await fetch(`${baseUrl}/api/v1/public/breeder/filings?licenseId=${licenseId}&filingType=TRANSFER_CONFIRMATION&limit=10`);
    expect(list.status).toBe(200);
    const listBody = await list.json();
    expect(listBody.count).toBe(1);
    expect(listBody.items[0].filingId).toBe(firstBody.filingId);
  });

  test('breeder filing amendment appends new event and marks overdue filing as cured', async () => {
    const licenseId = '0de0e9d3-916c-41a9-bf68-e3226b7ce8db';
    const originalOccurredAt = '2025-01-01T12:00:00.000Z';

    await pool.query(
      `INSERT INTO event_log (
        event_id, aggregate_type, aggregate_id, event_type, event_data,
        occurred_at, ingested_at, grant_cycle_id, correlation_id, causation_id,
        actor_id, actor_type
      ) VALUES (
        '018f0b63-0000-7000-8000-000000000121',
        'LICENSE',
        $1::uuid,
        'BREEDER_LICENSED',
        '{"licenseNumber":"BR-2025-0099","county":"MASON","expiresOn":"2026-12-31T23:59:59.000Z"}'::jsonb,
        NOW(), NOW(), 'BARKWV',
        'c80b220d-f8b6-4919-a1ba-d6775ad8b3cb'::uuid,
        NULL,
        '3c8fe8ce-88f0-4477-a25f-3ceea0988e2a'::uuid,
        'SYSTEM'
      )`,
      [licenseId]
    );

    const filed = await fetch(`${baseUrl}/api/v1/public/breeder/filings/transfer-confirmation`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        licenseId,
        occurredAt: originalOccurredAt,
        transferId: 'xfer-overdue-001',
        animalCount: 1,
      }),
    });
    expect(filed.status).toBe(201);
    const filedBody = await filed.json();

    const amended = await fetch(`${baseUrl}/api/v1/public/breeder/filings/${filedBody.filingId}/transfer-confirmation/amend`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        occurredAt: new Date().toISOString(),
        transferId: 'xfer-overdue-001-corrected',
        animalCount: 2,
      }),
    });

    expect(amended.status).toBe(200);
    const amendedBody = await amended.json();
    expect(amendedBody.filing.filingStatus).toBe('AMENDED');
    expect(amendedBody.filing.deadlineStatus).toBe('CURED');

    const timeline = await pool.query(
      `SELECT event_type
       FROM event_log
       WHERE aggregate_type = 'BREEDER_REPORTING'
         AND aggregate_id = $1::uuid
       ORDER BY ingested_at ASC, event_id ASC`,
      [filedBody.filingId]
    );

    expect(timeline.rows.map((row) => row.event_type)).toEqual([
      'BREEDER_TRANSFER_CONFIRMATION_FILED',
      'BREEDER_TRANSFER_CONFIRMATION_AMENDED',
    ]);

    const projection = await pool.query(
      `SELECT status, amended_at, cured_at
       FROM breeder_compliance_queue_projection
       WHERE filing_id = $1::uuid`,
      [filedBody.filingId]
    );
    expect(projection.rows.length).toBe(1);
    expect(projection.rows[0].status).toBe('CURED');
    expect(projection.rows[0].amended_at).toBeTruthy();
    expect(projection.rows[0].cured_at).toBeTruthy();
  });

  test('breeder compliance queue feed returns prioritized statuses for regulators', async () => {
    process.env.BARK_COMPLIANCE_READ_KEY = 'test-compliance-key';

    await pool.query(
      `INSERT INTO breeder_compliance_queue_projection (
        filing_id,
        license_id,
        grant_cycle_id,
        filing_type,
        reporting_year,
        reporting_quarter,
        occurred_at,
        due_at,
        cure_deadline_at,
        submitted_at,
        amended_at,
        cured_at,
        status,
        last_event_id,
        last_event_ingested_at,
        rebuilt_at,
        watermark_ingested_at,
        watermark_event_id
      ) VALUES
      (
        '66666666-6666-4666-8666-666666666661'::uuid,
        '77777777-7777-4777-8777-777777777771'::uuid,
        'BARKWV',
        'TRANSFER_CONFIRMATION',
        NULL,
        NULL,
        '2026-02-01T12:00:00.000Z',
        '2026-02-08T12:00:00.000Z',
        '2026-02-15T12:00:00.000Z',
        '2026-02-10T08:00:00.000Z',
        NULL,
        NULL,
        'OVERDUE',
        '018f0b63-0000-7000-8000-00000000bb01'::uuid,
        '2026-02-10T08:00:00.000Z',
        NOW(),
        NOW(),
        '018f0b63-0000-7000-8000-00000000bb09'::uuid
      ),
      (
        '66666666-6666-4666-8666-666666666662'::uuid,
        '77777777-7777-4777-8777-777777777772'::uuid,
        'BARKWV',
        'QUARTERLY_TRANSITION_REPORT',
        2026,
        1,
        '2026-01-01T00:00:00.000Z',
        '2026-04-30T23:59:59.000Z',
        NULL,
        '2026-04-15T12:00:00.000Z',
        NULL,
        NULL,
        'ON_TIME',
        '018f0b63-0000-7000-8000-00000000bb02'::uuid,
        '2026-04-15T12:00:00.000Z',
        NOW(),
        NOW(),
        '018f0b63-0000-7000-8000-00000000bb10'::uuid
      )`
    );

    const forbiddenRes = await fetch(`${baseUrl}/api/v1/public/compliance/breeder-queue`);
    expect(forbiddenRes.status).toBe(403);

    const res = await fetch(`${baseUrl}/api/v1/public/compliance/breeder-queue?limit=10`, {
      headers: {
        'x-wvda-admin-key': 'test-compliance-key',
      },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(2);
    expect(body.items[0].status).toBe('OVERDUE');
    expect(body.items[0].filingType).toBe('TRANSFER_CONFIRMATION');

    const filteredRes = await fetch(`${baseUrl}/api/v1/public/compliance/breeder-queue?status=overdue`, {
      headers: {
        'x-wvda-admin-key': 'test-compliance-key',
      },
    });
    expect(filteredRes.status).toBe(200);
    const filteredBody = await filteredRes.json();
    expect(filteredBody.count).toBe(1);
    expect(filteredBody.items[0].status).toBe('OVERDUE');
  });
});
