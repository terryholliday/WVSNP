/**
 * PHASE 5 E2E: OASIS Export + Grant Cycle Closeout via HTTP
 * Tests the full admin API pipeline end-to-end through Express routes.
 */

import { Pool } from 'pg';
import { readFileSync } from 'fs';
import { join } from 'path';
import jwt from 'jsonwebtoken';
import type { Server } from 'http';

const JWT_SECRET = 'dev-secret-change-in-production';

let pool: Pool;
let server: Server;
let baseUrl: string;
let adminToken: string;
let closeApiPool: (() => Promise<void>) | undefined;

function makeAdminToken(permissions: string[]): string {
  return jwt.sign(
    {
      sub: 'e2e-admin-' + crypto.randomUUID().substring(0, 8),
      role: 'ADMIN',
      permissions,
    },
    JWT_SECRET,
    { expiresIn: '1h' }
  );
}

async function adminPost(path: string, body: Record<string, any>, idempotencyKey?: string): Promise<Response> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${adminToken}`,
  };
  if (idempotencyKey) {
    headers['Idempotency-Key'] = idempotencyKey;
  }
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

async function adminGet(path: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${adminToken}`,
    },
  });
}

describe('OASIS + Closeout E2E Pipeline', () => {
  beforeAll(async () => {
    const dbHost = process.env.DB_HOST || 'localhost';
    const dbPort = parseInt(process.env.DB_PORT || '5433', 10);
    const dbName = process.env.DB_NAME || 'wvsnp_e2e_oasis';
    const dbUser = process.env.DB_USER || 'postgres';
    const dbPassword = process.env.DB_PASSWORD || 'postgres';
    process.env.DATABASE_URL = `postgresql://${dbUser}:${dbPassword}@${dbHost}:${dbPort}/${dbName}`;
    process.env.JWT_SECRET = JWT_SECRET;

    // Create database if it doesn't exist
    const adminPool = new Pool({
      host: dbHost, port: dbPort, database: 'postgres', user: dbUser, password: dbPassword,
    });
    try {
      await adminPool.query(`CREATE DATABASE "${dbName}"`);
    } catch (error: any) {
      if (!error.message.includes('already exists')) throw error;
    }
    await adminPool.end();

    // Apply schema
    const setupPool = new Pool({
      host: dbHost, port: dbPort, database: dbName, user: dbUser, password: dbPassword,
    });
    const schemaPath = join(__dirname, '../../db/schema.sql');
    const schemaSqlRaw = readFileSync(schemaPath, 'utf-8');
    const schemaSql = schemaSqlRaw.replace(/^\uFEFF/, '').replace(/\u200B/g, '');
    await setupPool.query(schemaSql);
    await setupPool.end();

    // Start API server
    const serverModule = await import('../../src/api/server');
    const app = serverModule.default;
    closeApiPool = serverModule.closeApiPool;
    pool = serverModule.apiPool as Pool;

    server = app.listen(0);
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('FAILED_TO_START_SERVER');
    baseUrl = `http://127.0.0.1:${(address as any).port}`;

    // Create admin JWT with all required permissions
    adminToken = makeAdminToken([
      'exports:generate',
      'closeout:manage',
      'invoices:generate',
      'claims:view',
      'claims:approve',
      'claims:deny',
    ]);
  }, 60_000);

  beforeEach(async () => {
    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await pool.query(`
          TRUNCATE event_log, idempotency_cache,
                   oasis_export_batches_projection, oasis_export_batch_items_projection,
                   invoices_projection, vet_clinics_projection,
                   grant_cycle_closeout_projection, grant_balances_projection,
                   claims_projection, invoice_adjustments_projection,
                   payments_projection
          CASCADE
        `);
        return;
      } catch (error: any) {
        if (attempt === maxRetries) throw error;
        if (error.message.includes('deadlock') || error.message.includes('lock')) {
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
          continue;
        }
        throw error;
      }
    }
  }, 30_000);

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      if (!server) return resolve();
      server.close((err) => (err ? reject(err) : resolve()));
    });
    if (closeApiPool) await closeApiPool();
    await new Promise(resolve => setTimeout(resolve, 1000));
  });

  // ─── OASIS EXPORT PIPELINE ──────────────────────────────────────────

  describe('OASIS Export Pipeline', () => {
    const grantCycleId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

    async function seedInvoiceData(): Promise<void> {
      // Seed clinic with vendor code
      await pool.query(`
        INSERT INTO vet_clinics_projection (
          clinic_id, clinic_name, status, license_status, license_number, license_expires_at,
          oasis_vendor_code, payment_info, registered_at, suspended_at, reinstated_at,
          rebuilt_at, watermark_ingested_at, watermark_event_id
        ) VALUES (
          '11111111-1111-1111-1111-111111111111', 'E2E Test Clinic', 'ACTIVE', 'VALID', 'LIC-E2E', '2027-12-31',
          'VNDRE2E', NULL, NOW(), NULL, NULL, NOW(), NOW(), gen_random_uuid()
        ) ON CONFLICT (clinic_id) DO NOTHING
      `);

      // Seed invoice
      await pool.query(`
        INSERT INTO invoices_projection (
          invoice_id, clinic_id, invoice_period_start, invoice_period_end,
          grant_cycle_id, total_amount_cents, claim_ids, adjustment_ids, status, submitted_at, generated_at,
          rebuilt_at, watermark_ingested_at, watermark_event_id
        ) VALUES (
          '22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111',
          '2026-01-01', '2026-01-31', $1, 75000, '[]'::jsonb, '[]'::jsonb,
          'SUBMITTED', NOW(), NOW(),
          '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', gen_random_uuid()
        ) ON CONFLICT (invoice_id) DO NOTHING
      `, [grantCycleId]);
    }

    test('E2E-1: Generate OASIS export via API', async () => {
      await seedInvoiceData();

      const watermarkRes = await adminGet('/api/v1/admin/watermark');
      // Watermark may be empty if no events yet — use fixed values
      const watermarkEventId = crypto.randomUUID();

      const res = await adminPost('/api/v1/admin/exports/oasis', {
        grantCycleId,
        periodStart: '2026-01-01',
        periodEnd: '2026-01-31',
        watermarkIngestedAt: '2026-01-31T23:59:59.000Z',
        watermarkEventId,
      }, 'e2e-gen-001');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.exportBatchId).toBeDefined();
      expect(body.recordCount).toBe(1);
      expect(body.fileSha256).toBeDefined();
      expect(body.downloadUrl).toContain(body.exportBatchId);
    });

    test('E2E-2: Full OASIS lifecycle: generate → submit → acknowledge', async () => {
      await seedInvoiceData();

      // Generate
      const genRes = await adminPost('/api/v1/admin/exports/oasis', {
        grantCycleId,
        periodStart: '2026-01-01',
        periodEnd: '2026-01-31',
        watermarkIngestedAt: '2026-01-31T23:59:59.000Z',
        watermarkEventId: crypto.randomUUID(),
      }, 'e2e-gen-002');
      expect(genRes.status).toBe(200);
      const genBody = await genRes.json();
      const batchId = genBody.exportBatchId;

      // Submit
      const submitRes = await adminPost(`/api/v1/admin/exports/oasis/${batchId}/submit`, {
        submissionMethod: 'MANUAL_UPLOAD',
      }, 'e2e-submit-002');
      expect(submitRes.status).toBe(200);
      const submitBody = await submitRes.json();
      expect(submitBody.status).toBe('SUBMITTED');

      // Acknowledge
      const ackRes = await adminPost(`/api/v1/admin/exports/oasis/${batchId}/acknowledge`, {
        oasisRefId: 'OASIS-REF-12345',
        acceptedAt: new Date().toISOString(),
        notes: 'E2E test acknowledgement',
      }, 'e2e-ack-002');
      expect(ackRes.status).toBe(200);
      const ackBody = await ackRes.json();
      expect(ackBody.status).toBe('ACKNOWLEDGED');

      // Verify via GET detail
      const detailRes = await adminGet(`/api/v1/admin/exports/oasis/${batchId}`);
      expect(detailRes.status).toBe(200);
      const detail = await detailRes.json();
      expect(detail.status).toBe('ACKNOWLEDGED');
      expect(detail.items.length).toBe(1);
    });

    test('E2E-3: Reject batch releases invoices', async () => {
      await seedInvoiceData();

      // Generate + submit
      const genRes = await adminPost('/api/v1/admin/exports/oasis', {
        grantCycleId,
        periodStart: '2026-01-01',
        periodEnd: '2026-01-31',
        watermarkIngestedAt: '2026-01-31T23:59:59.000Z',
        watermarkEventId: crypto.randomUUID(),
      }, 'e2e-gen-003');
      const genBody = await genRes.json();
      const batchId = genBody.exportBatchId;

      await adminPost(`/api/v1/admin/exports/oasis/${batchId}/submit`, {
        submissionMethod: 'MANUAL_UPLOAD',
      }, 'e2e-submit-003');

      // Reject
      const rejectRes = await adminPost(`/api/v1/admin/exports/oasis/${batchId}/reject`, {
        rejectionReason: 'Format error in detail records',
        rejectionCode: 'FMT_ERR',
      }, 'e2e-reject-003');
      expect(rejectRes.status).toBe(200);
      const rejectBody = await rejectRes.json();
      expect(rejectBody.status).toBe('REJECTED');

      // Verify invoices released
      const invoices = await pool.query(
        'SELECT oasis_export_batch_id FROM invoices_projection WHERE grant_cycle_id = $1',
        [grantCycleId]
      );
      for (const row of invoices.rows) {
        expect(row.oasis_export_batch_id).toBeNull();
      }
    });

    test('E2E-4: Void batch releases invoices', async () => {
      await seedInvoiceData();

      // Generate (not yet submitted — can void directly)
      const genRes = await adminPost('/api/v1/admin/exports/oasis', {
        grantCycleId,
        periodStart: '2026-01-01',
        periodEnd: '2026-01-31',
        watermarkIngestedAt: '2026-01-31T23:59:59.000Z',
        watermarkEventId: crypto.randomUUID(),
      }, 'e2e-gen-004');
      const genBody = await genRes.json();
      const batchId = genBody.exportBatchId;

      // Void
      const voidRes = await adminPost(`/api/v1/admin/exports/oasis/${batchId}/void`, {
        reason: 'Incorrect period selected',
      }, 'e2e-void-004');
      expect(voidRes.status).toBe(200);
      const voidBody = await voidRes.json();
      expect(voidBody.status).toBe('VOIDED');

      // Verify invoices released
      const invoices = await pool.query(
        'SELECT oasis_export_batch_id FROM invoices_projection WHERE grant_cycle_id = $1',
        [grantCycleId]
      );
      for (const row of invoices.rows) {
        expect(row.oasis_export_batch_id).toBeNull();
      }
    });

    test('E2E-5: List batches returns created batch', async () => {
      await seedInvoiceData();

      // Generate a batch
      await adminPost('/api/v1/admin/exports/oasis', {
        grantCycleId,
        periodStart: '2026-01-01',
        periodEnd: '2026-01-31',
        watermarkIngestedAt: '2026-01-31T23:59:59.000Z',
        watermarkEventId: crypto.randomUUID(),
      }, 'e2e-gen-005');

      // List
      const listRes = await adminGet(`/api/v1/admin/exports/oasis?grantCycleId=${grantCycleId}`);
      expect(listRes.status).toBe(200);
      const listBody = await listRes.json();
      expect(listBody.batches.length).toBeGreaterThanOrEqual(1);
      expect(listBody.batches[0].grantCycleId).toBe(grantCycleId);
    });

    test('E2E-6: Missing idempotency key returns 400', async () => {
      const res = await fetch(`${baseUrl}/api/v1/admin/exports/oasis`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          grantCycleId,
          periodStart: '2026-01-01',
          periodEnd: '2026-01-31',
          watermarkIngestedAt: '2026-01-31T23:59:59.000Z',
          watermarkEventId: crypto.randomUUID(),
        }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe('MISSING_IDEMPOTENCY_KEY');
    });

    test('E2E-7: Unauthenticated request returns 401', async () => {
      const res = await fetch(`${baseUrl}/api/v1/admin/exports/oasis`, {
        method: 'GET',
      });
      expect(res.status).toBe(401);
    });

    test('E2E-8: Insufficient permissions returns 403', async () => {
      const limitedToken = makeAdminToken(['claims:view']); // No exports:generate
      const res = await fetch(`${baseUrl}/api/v1/admin/exports/oasis`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${limitedToken}` },
      });
      expect(res.status).toBe(403);
    });
  });

  // ─── GRANT CYCLE CLOSEOUT PIPELINE ──────────────────────────────────

  describe('Grant Cycle Closeout Pipeline', () => {
    const grantCycleId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

    test('E2E-9: Get closeout status for non-started cycle', async () => {
      const res = await adminGet(`/api/v1/admin/closeout/${grantCycleId}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.closeoutStatus).toBe('NOT_STARTED');
    });

    test('E2E-10: Full closeout lifecycle: preflight → start → reconcile → close', async () => {
      // Seed grant balance data for reconciliation
      await pool.query(`
        INSERT INTO grant_balances_projection (
          grant_id, grant_cycle_id, bucket_type,
          awarded_cents, available_cents, encumbered_cents, liquidated_cents, released_cents,
          rate_numerator_cents, rate_denominator_cents,
          matching_committed_cents, matching_reported_cents,
          rebuilt_at, watermark_ingested_at, watermark_event_id
        ) VALUES (
          gen_random_uuid(), $1, 'GENERAL',
          200000, 50000, 0, 150000, 0,
          7500, 10000,
          50000, 50000,
          NOW(), NOW(), gen_random_uuid()
        )
      `, [grantCycleId]);

      // Preflight
      const preflightRes = await adminPost(`/api/v1/admin/closeout/${grantCycleId}/preflight`, {}, 'e2e-preflight-010');
      expect(preflightRes.status).toBe(200);
      const preflightBody = await preflightRes.json();
      expect(preflightBody.status).toBe('PASSED');

      // Start
      const startRes = await adminPost(`/api/v1/admin/closeout/${grantCycleId}/start`, {}, 'e2e-start-010');
      expect(startRes.status).toBe(200);
      const startBody = await startRes.json();
      expect(startBody.status).toBe('STARTED');

      // Reconcile
      const reconcileRes = await adminPost(`/api/v1/admin/closeout/${grantCycleId}/reconcile`, {
        watermarkIngestedAt: new Date().toISOString(),
        watermarkEventId: crypto.randomUUID(),
      }, 'e2e-reconcile-010');
      expect(reconcileRes.status).toBe(200);
      const reconcileBody = await reconcileRes.json();
      expect(reconcileBody.status).toBe('RECONCILED');

      // Close
      const closeRes = await adminPost(`/api/v1/admin/closeout/${grantCycleId}/close`, {}, 'e2e-close-010');
      expect(closeRes.status).toBe(200);
      const closeBody = await closeRes.json();
      expect(closeBody.status).toBe('CLOSED');

      // Verify status
      const statusRes = await adminGet(`/api/v1/admin/closeout/${grantCycleId}`);
      expect(statusRes.status).toBe(200);
      const statusBody = await statusRes.json();
      expect(statusBody.closeoutStatus).toBe('CLOSED');
    });

    test('E2E-11: Audit hold blocks close, resolve allows it', async () => {
      const cycleId = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

      // Seed balance data
      await pool.query(`
        INSERT INTO grant_balances_projection (
          grant_id, grant_cycle_id, bucket_type,
          awarded_cents, available_cents, encumbered_cents, liquidated_cents, released_cents,
          rate_numerator_cents, rate_denominator_cents,
          matching_committed_cents, matching_reported_cents,
          rebuilt_at, watermark_ingested_at, watermark_event_id
        ) VALUES (
          gen_random_uuid(), $1, 'GENERAL',
          100000, 20000, 0, 80000, 0,
          7500, 10000,
          25000, 25000,
          NOW(), NOW(), gen_random_uuid()
        )
      `, [cycleId]);

      // Preflight → start → reconcile
      await adminPost(`/api/v1/admin/closeout/${cycleId}/preflight`, {}, 'e2e-preflight-011');
      await adminPost(`/api/v1/admin/closeout/${cycleId}/start`, {}, 'e2e-start-011');
      await adminPost(`/api/v1/admin/closeout/${cycleId}/reconcile`, {
        watermarkIngestedAt: new Date().toISOString(),
        watermarkEventId: crypto.randomUUID(),
      }, 'e2e-reconcile-011');

      // Audit hold
      const holdRes = await adminPost(`/api/v1/admin/closeout/${cycleId}/audit-hold`, {
        reason: 'Suspicious matching fund discrepancy',
      }, 'e2e-hold-011');
      expect(holdRes.status).toBe(200);
      const holdBody = await holdRes.json();
      expect(holdBody.status).toBe('AUDIT_HOLD');

      // Attempt close — should fail (500 with AUDIT_HOLD_ACTIVE)
      const closeAttempt = await adminPost(`/api/v1/admin/closeout/${cycleId}/close`, {}, 'e2e-close-011-fail');
      expect(closeAttempt.status).toBe(500);

      // Resolve audit
      const resolveRes = await adminPost(`/api/v1/admin/closeout/${cycleId}/audit-resolve`, {
        resolution: 'Discrepancy explained by late reporting',
      }, 'e2e-resolve-011');
      expect(resolveRes.status).toBe(200);
      const resolveBody = await resolveRes.json();
      expect(resolveBody.status).toBe('RECONCILED');

      // Now close should succeed
      const closeRes = await adminPost(`/api/v1/admin/closeout/${cycleId}/close`, {}, 'e2e-close-011-ok');
      expect(closeRes.status).toBe(200);
      const closeBody = await closeRes.json();
      expect(closeBody.status).toBe('CLOSED');
    });

    test('E2E-12: Start without preflight returns error', async () => {
      const cycleId = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

      const startRes = await adminPost(`/api/v1/admin/closeout/${cycleId}/start`, {}, 'e2e-start-012');
      // Should fail because preflight hasn't been run
      expect(startRes.status).toBe(500);
    });
  });
});
