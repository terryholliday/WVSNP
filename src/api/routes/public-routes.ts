import { Router } from 'express';
import { Pool } from 'pg';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import { EventStore } from '../../event-store';
import { ApiError } from '../middleware/auth';

const LICENSE_EVENT_TYPES = [
  'BREEDER_LICENSED',
  'BREEDER_LICENSE_RENEWED',
  'BREEDER_LICENSE_STATUS_CHANGED',
  'TRANSPORTER_LICENSED',
  'TRANSPORTER_LICENSE_RENEWED',
  'TRANSPORTER_LICENSE_STATUS_CHANGED',
];

const INSPECTION_EVENT_TYPES = [
  'LICENSE_INSPECTED',
  'LICENSE_REINSPECTED',
  'INSPECTION_GRADE_ASSIGNED',
];

const ENFORCEMENT_EVENT_TYPES = [
  'LICENSE_ENFORCEMENT_ACTION_TAKEN',
  'LICENSE_SUSPENDED',
  'LICENSE_REVOKED',
  'ADMINISTRATIVE_PENALTY_ASSESSED',
];

const PROHIBITION_EVENT_TYPES = [
  'PROHIBITION_ORDER_ISSUED',
  'PROHIBITION_ORDER_LIFTED',
];

const VERIFY_TOKEN_ISSUER = process.env.BARK_VERIFY_ISSUER_KEY_ID || 'barkwv-v1';
const VERIFY_TOKEN_SECRET = process.env.BARK_VERIFY_TOKEN_SECRET || 'dev-bark-verify-secret-change-me';
const DEFAULT_GRANT_CYCLE_ID = process.env.BARK_GRANT_CYCLE_ID || 'BARKWV';

type LicenseStatus = 'PENDING_REVIEW' | 'ACTIVE' | 'EXPIRED' | 'SUSPENDED' | 'REVOKED';

interface PublicLicenseProjection {
  licenseId: string;
  licenseNumber: string | null;
  licenseType: 'BREEDER' | 'TRANSPORTER';
  status: LicenseStatus;
  county: string | null;
  activeFrom: string | null;
  expiresOn: string | null;
  inspectionGrade: string;
  enforcementActions: number;
  signedToken?: string;
}

interface DashboardSummary extends TransparencySnapshot {
  month: string;
  inspectionsCompleted: number;
  enforcementActionsFinal: number;
  prohibitionOrdersActive: number;
  impoundSubmissionsLogged: number;
  csvPath: string;
}

interface PublicInspectionRecord {
  licenseId: string;
  licenseNumber: string | null;
  licenseType: 'BREEDER' | 'TRANSPORTER';
  inspectionDate: string | null;
  inspectionGrade: string;
  summaryFindings: string | null;
}

interface PublicEnforcementAction {
  actionId: string;
  licenseId: string;
  licenseNumber: string | null;
  violationClass: string | null;
  actionType: string;
  penaltyAmountCents: number | null;
  occurredAt: string;
}

interface PublicProhibitionOrder {
  orderId: string;
  subjectLicenseId: string | null;
  subjectLicenseNumber: string | null;
  status: 'ACTIVE' | 'LIFTED';
  effectiveAt: string;
  liftedAt: string | null;
  reason: string | null;
}

interface TransparencySnapshot {
  snapshotPeriod: string;
  generatedAt: string;
  totals: {
    activeBreeders: number;
    activeTransporters: number;
    suspendedOrRevokedLicenses: number;
    verificationsLogged: number;
  };
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function parseLicenseStatus(eventType: string, eventData: Record<string, unknown>): LicenseStatus {
  const statusFromPayload = typeof eventData.newStatus === 'string'
    ? eventData.newStatus.toUpperCase()
    : null;
  if (
    statusFromPayload === 'PENDING_REVIEW' ||
    statusFromPayload === 'ACTIVE' ||
    statusFromPayload === 'EXPIRED' ||
    statusFromPayload === 'SUSPENDED' ||
    statusFromPayload === 'REVOKED'
  ) {
    return statusFromPayload;
  }

  if (eventType.endsWith('_LICENSED') || eventType.endsWith('_LICENSE_RENEWED')) {
    return 'ACTIVE';
  }

  return 'PENDING_REVIEW';
}

function parseLicenseType(eventType: string, eventData: Record<string, unknown>): 'BREEDER' | 'TRANSPORTER' {
  if (eventType.startsWith('TRANSPORTER_')) {
    return 'TRANSPORTER';
  }
  if (typeof eventData.licenseType === 'string' && eventData.licenseType.toUpperCase() === 'TRANSPORTER') {
    return 'TRANSPORTER';
  }
  return 'BREEDER';
}

function asNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function asNullableNumber(value: unknown): number | null {
  const next = Number(value);
  return Number.isFinite(next) ? next : null;
}

function projectLicense(row: any): PublicLicenseProjection {
  const eventData = (row.event_data ?? {}) as Record<string, unknown>;
  const licenseType = parseLicenseType(row.event_type, eventData);
  const status = parseLicenseStatus(row.event_type, eventData);
  return {
    licenseId: row.license_id,
    licenseNumber: typeof eventData.licenseNumber === 'string' ? eventData.licenseNumber : null,
    licenseType,
    status,
    county: typeof eventData.county === 'string' ? eventData.county : null,
    activeFrom: typeof eventData.activeFrom === 'string' ? eventData.activeFrom : row.occurred_at?.toISOString() ?? null,
    expiresOn: typeof eventData.expiresOn === 'string' ? eventData.expiresOn : null,
    inspectionGrade: typeof eventData.inspectionGrade === 'string' ? eventData.inspectionGrade : 'PENDING',
    enforcementActions: Number(eventData.enforcementActions ?? 0) || 0,
  };
}

function buildSignedToken(licenseId: string, expiresOn: string | null): string {
  const validUntil = expiresOn ?? 'UNKNOWN';
  const payload = `${licenseId}|${validUntil}|${VERIFY_TOKEN_ISSUER}`;
  const signature = crypto.createHmac('sha256', VERIFY_TOKEN_SECRET).update(payload, 'utf8').digest('hex');
  return `${VERIFY_TOKEN_ISSUER}.${validUntil}.${signature}`;
}

function verifySignedToken(licenseId: string, token: string): boolean {
  const tokenParts = token.split('.');
  if (tokenParts.length !== 3) {
    return false;
  }

  const [issuerKeyId, validUntil, signature] = tokenParts;
  if (issuerKeyId !== VERIFY_TOKEN_ISSUER || !validUntil || !signature) {
    return false;
  }

  if (!/^[0-9a-f]{64}$/i.test(signature)) {
    return false;
  }

  if (validUntil !== 'UNKNOWN') {
    const expiresAt = new Date(validUntil);
    if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() < Date.now()) {
      return false;
    }
  }

  const payload = `${licenseId}|${validUntil}|${issuerKeyId}`;
  const expected = crypto.createHmac('sha256', VERIFY_TOKEN_SECRET).update(payload, 'utf8').digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature, 'utf8'), Buffer.from(expected, 'utf8'));
}

async function appendPublicEvent(
  store: EventStore,
  eventType: string,
  aggregateType: string,
  aggregateId: string,
  eventData: Record<string, unknown>,
  correlationId: string,
  causationId: string | null = null
): Promise<string> {
  const eventId = EventStore.newEventId();
  await store.append({
    eventId,
    aggregateType,
    aggregateId,
    eventType,
    eventData,
    occurredAt: new Date(),
    grantCycleId: DEFAULT_GRANT_CYCLE_ID,
    correlationId,
    causationId,
    actorId: crypto.randomUUID() as any,
    actorType: 'SYSTEM',
  });
  return eventId;
}

async function getLicenseProjection(pool: Pool, licenseId: string): Promise<PublicLicenseProjection | null> {
  if (!isUuid(licenseId)) {
    return null;
  }

  const result = await pool.query(
    `SELECT DISTINCT ON (aggregate_id)
        aggregate_id::text AS license_id,
        event_type,
        event_data,
        occurred_at,
        ingested_at
      FROM event_log
      WHERE aggregate_type = 'LICENSE'
        AND event_type = ANY($1::text[])
        AND aggregate_id = $2::uuid
      ORDER BY aggregate_id, ingested_at DESC, event_id DESC`,
    [LICENSE_EVENT_TYPES, licenseId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return projectLicense(result.rows[0]);
}

async function getLicenseProjectionByNumber(pool: Pool, licenseNumber: string): Promise<PublicLicenseProjection | null> {
  if (!licenseNumber.trim()) {
    return null;
  }

  const result = await pool.query(
    `SELECT DISTINCT ON (aggregate_id)
        aggregate_id::text AS license_id,
        event_type,
        event_data,
        occurred_at,
        ingested_at
      FROM event_log
      WHERE aggregate_type = 'LICENSE'
        AND event_type = ANY($1::text[])
        AND COALESCE(event_data->>'licenseNumber', '') ILIKE $2
      ORDER BY aggregate_id, ingested_at DESC, event_id DESC
      LIMIT 1`,
    [LICENSE_EVENT_TYPES, licenseNumber]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return projectLicense(result.rows[0]);
}

async function getLatestLicenseProjections(
  pool: Pool,
  options: { query?: string; limit?: number; licenseType?: 'BREEDER' | 'TRANSPORTER' }
): Promise<PublicLicenseProjection[]> {
  const query = options.query?.trim() ?? '';
  const limit = Math.min(options.limit ?? 25, 250);
  const searchTerm = query.length > 0 ? `%${query}%` : null;

  const result = await pool.query(
    `SELECT DISTINCT ON (aggregate_id)
        aggregate_id::text AS license_id,
        event_type,
        event_data,
        occurred_at,
        ingested_at
      FROM event_log
      WHERE aggregate_type = 'LICENSE'
        AND event_type = ANY($1::text[])
        AND (
          $2::text IS NULL
          OR COALESCE(event_data->>'licenseNumber', '') ILIKE $2
          OR COALESCE(event_data->>'county', '') ILIKE $2
          OR COALESCE(event_data->>'licenseType', '') ILIKE $2
        )
      ORDER BY aggregate_id, ingested_at DESC, event_id DESC
      LIMIT $3`,
    [LICENSE_EVENT_TYPES, searchTerm, limit]
  );

  const projected = result.rows.map(projectLicense);
  if (!options.licenseType) {
    return projected;
  }

  return projected.filter((item) => item.licenseType === options.licenseType);
}

function buildDashboardCsv(snapshot: DashboardSummary): string {
  const headers = [
    'month',
    'generatedAt',
    'activeBreeders',
    'activeTransporters',
    'suspendedOrRevokedLicenses',
    'verificationsLogged',
    'inspectionsCompleted',
    'enforcementActionsFinal',
    'prohibitionOrdersActive',
    'impoundSubmissionsLogged',
  ];

  const values = [
    snapshot.month,
    snapshot.generatedAt,
    String(snapshot.totals.activeBreeders),
    String(snapshot.totals.activeTransporters),
    String(snapshot.totals.suspendedOrRevokedLicenses),
    String(snapshot.totals.verificationsLogged),
    String(snapshot.inspectionsCompleted),
    String(snapshot.enforcementActionsFinal),
    String(snapshot.prohibitionOrdersActive),
    String(snapshot.impoundSubmissionsLogged),
  ];

  return `${headers.join(',')}\n${values.join(',')}\n`;
}

async function buildDashboardSummary(pool: Pool, month: string): Promise<DashboardSummary> {
  const base = await buildSnapshot(pool, month);
  const [inspections, enforcement, prohibitions, impounds] = await Promise.all([
    pool.query(
      `SELECT COUNT(*)::int AS count
        FROM event_log
        WHERE event_type = ANY($1::text[])
          AND to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM') = $2`,
      [INSPECTION_EVENT_TYPES, month]
    ),
    pool.query(
      `SELECT COUNT(*)::int AS count
        FROM event_log
        WHERE event_type = ANY($1::text[])
          AND to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM') = $2`,
      [ENFORCEMENT_EVENT_TYPES, month]
    ),
    pool.query(
      `SELECT COUNT(*)::int AS count
        FROM event_log
        WHERE event_type = 'PROHIBITION_ORDER_ISSUED'
          AND to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM') <= $1`,
      [month]
    ),
    pool.query(
      `SELECT COUNT(*)::int AS count
        FROM event_log
        WHERE event_type = 'IMPOUNDED_ANIMAL_DATA_SUBMITTED'
          AND to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM') = $1`,
      [month]
    ),
  ]);

  return {
    ...base,
    month,
    inspectionsCompleted: inspections.rows[0]?.count ?? 0,
    enforcementActionsFinal: enforcement.rows[0]?.count ?? 0,
    prohibitionOrdersActive: prohibitions.rows[0]?.count ?? 0,
    impoundSubmissionsLogged: impounds.rows[0]?.count ?? 0,
    csvPath: `/api/v1/public/dashboard/monthly/${month}.csv`,
  };
}

function renderVerifyHtml(license: PublicLicenseProjection): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>BARK License Verification</title>
    <style>
      :root { color-scheme: light; }
      body { font-family: Georgia, serif; margin: 2rem auto; max-width: 720px; line-height: 1.4; color: #1a1a1a; }
      .status { font-weight: 700; font-size: 1.4rem; }
      .meta { color: #4a4a4a; }
      .card { border: 1px solid #d9d9d9; border-radius: 12px; padding: 1rem 1.25rem; background: #fbfbfb; }
      dl { display: grid; grid-template-columns: 12rem 1fr; gap: 0.5rem 1rem; margin: 1rem 0 0; }
      dt { color: #525252; }
      dd { margin: 0; font-weight: 600; }
    </style>
  </head>
  <body>
    <h1>BARK License Verification</h1>
    <div class="card">
      <div class="status">${license.status}</div>
      <p class="meta">This page is served from the permanent path contract: <code>/v1/l/{licenseId}</code>.</p>
      <dl>
        <dt>License ID</dt><dd>${license.licenseId}</dd>
        <dt>License Number</dt><dd>${license.licenseNumber ?? 'N/A'}</dd>
        <dt>License Type</dt><dd>${license.licenseType}</dd>
        <dt>County</dt><dd>${license.county ?? 'N/A'}</dd>
        <dt>Active From</dt><dd>${license.activeFrom ?? 'N/A'}</dd>
        <dt>Expires On</dt><dd>${license.expiresOn ?? 'N/A'}</dd>
        <dt>Inspection Grade</dt><dd>${license.inspectionGrade}</dd>
      </dl>
    </div>
  </body>
</html>`;
}

async function buildSnapshot(pool: Pool, snapshotPeriod: string): Promise<TransparencySnapshot> {
  const licenseRows = await pool.query(
    `SELECT DISTINCT ON (aggregate_id)
        aggregate_id::text AS license_id,
        event_type,
        event_data,
        occurred_at,
        ingested_at
      FROM event_log
      WHERE aggregate_type = 'LICENSE'
        AND event_type = ANY($1::text[])
      ORDER BY aggregate_id, ingested_at DESC, event_id DESC`,
    [LICENSE_EVENT_TYPES]
  );

  const projected = licenseRows.rows.map(projectLicense);
  const activeBreeders = projected.filter((item) => item.licenseType === 'BREEDER' && item.status === 'ACTIVE').length;
  const activeTransporters = projected.filter((item) => item.licenseType === 'TRANSPORTER' && item.status === 'ACTIVE').length;
  const suspendedOrRevokedLicenses = projected.filter((item) => item.status === 'SUSPENDED' || item.status === 'REVOKED').length;

  const verificationCount = await pool.query(
    `SELECT COUNT(*)::int AS count
      FROM event_log
      WHERE event_type = 'LICENSE_VERIFICATION_PERFORMED'
        AND to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM') = $1`,
    [snapshotPeriod]
  );

  return {
    snapshotPeriod,
    generatedAt: new Date().toISOString(),
    totals: {
      activeBreeders,
      activeTransporters,
      suspendedOrRevokedLicenses,
      verificationsLogged: verificationCount.rows[0]?.count ?? 0,
    },
  };
}

export function createPublicRoutes(pool: Pool, store: EventStore) {
  const router = Router();

  const verifyLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
  });

  const registryLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
  });

  // Lookup Voucher by Code (for found pet scenarios)
  router.get('/vouchers/:voucherCode', async (req, res, next) => {
    try {
      const { voucherCode } = req.params;

      const result = await pool.query(
        `SELECT voucher_id, voucher_code, status, issued_at, redeemed_at, expired_at, voided_at
         FROM vouchers_projection
         WHERE voucher_code = $1`,
        [voucherCode]
      );

      if (result.rows.length === 0) {
        throw new ApiError(404, 'VOUCHER_NOT_FOUND', 'Voucher not found');
      }

      const voucher = result.rows[0];

      res.json({
        voucherId: voucher.voucher_id,
        voucherCode: voucher.voucher_code,
        status: voucher.status,
        issuedAt: voucher.issued_at?.toISOString(),
        redeemedAt: voucher.redeemed_at?.toISOString(),
        expiredAt: voucher.expired_at?.toISOString(),
        voidedAt: voucher.voided_at?.toISOString()
      });
    } catch (error) {
      next(error);
    }
  });

  // Public License Registry Search
  router.get('/registry/licenses', registryLimiter, async (req, res, next) => {
    try {
      const query = typeof req.query.q === 'string' ? req.query.q : '';
      const limit = Math.min(Number(req.query.limit ?? 25) || 25, 100);
      const items = await getLatestLicenseProjections(pool, { query, limit });

      res.json({
        items,
        count: items.length,
      });
    } catch (error) {
      next(error);
    }
  });

  // Public transporter registry
  router.get('/registry/transporters', registryLimiter, async (req, res, next) => {
    try {
      const query = typeof req.query.q === 'string' ? req.query.q : '';
      const limit = Math.min(Number(req.query.limit ?? 25) || 25, 100);
      const items = await getLatestLicenseProjections(pool, { query, limit, licenseType: 'TRANSPORTER' });
      res.json({
        items,
        count: items.length,
      });
    } catch (error) {
      next(error);
    }
  });

  // Public inspection feed
  router.get('/registry/inspections', registryLimiter, async (req, res, next) => {
    try {
      const query = typeof req.query.q === 'string' ? req.query.q : '';
      const limit = Math.min(Number(req.query.limit ?? 25) || 25, 100);
      const licenses = await getLatestLicenseProjections(pool, { query, limit });
      const items: PublicInspectionRecord[] = licenses.map((license) => ({
        licenseId: license.licenseId,
        licenseNumber: license.licenseNumber,
        licenseType: license.licenseType,
        inspectionDate: license.activeFrom,
        inspectionGrade: license.inspectionGrade,
        summaryFindings: null,
      }));

      res.json({
        items,
        count: items.length,
      });
    } catch (error) {
      next(error);
    }
  });

  // Public enforcement action feed
  router.get('/registry/enforcement-actions', registryLimiter, async (req, res, next) => {
    try {
      const limit = Math.min(Number(req.query.limit ?? 50) || 50, 200);
      const result = await pool.query(
        `SELECT event_id::text,
                aggregate_id::text AS license_id,
                event_type,
                event_data,
                occurred_at
         FROM event_log
         WHERE event_type = ANY($1::text[])
         ORDER BY ingested_at DESC, event_id DESC
         LIMIT $2`,
        [ENFORCEMENT_EVENT_TYPES, limit]
      );

      const items: PublicEnforcementAction[] = result.rows.map((row: any) => {
        const eventData = (row.event_data ?? {}) as Record<string, unknown>;
        return {
          actionId: row.event_id,
          licenseId: row.license_id,
          licenseNumber: asNullableString(eventData.licenseNumber),
          violationClass: asNullableString(eventData.violationClass),
          actionType: row.event_type,
          penaltyAmountCents: asNullableNumber(eventData.penaltyAmountCents),
          occurredAt: row.occurred_at?.toISOString?.() ?? String(row.occurred_at),
        };
      });

      res.json({
        items,
        count: items.length,
      });
    } catch (error) {
      next(error);
    }
  });

  // Public prohibition order feed
  router.get('/registry/prohibition-orders', registryLimiter, async (req, res, next) => {
    try {
      const limit = Math.min(Number(req.query.limit ?? 50) || 50, 200);
      const result = await pool.query(
        `SELECT event_id::text,
                aggregate_id::text,
                event_type,
                event_data,
                occurred_at
         FROM event_log
         WHERE event_type = ANY($1::text[])
         ORDER BY ingested_at DESC, event_id DESC
         LIMIT $2`,
        [PROHIBITION_EVENT_TYPES, limit]
      );

      const items: PublicProhibitionOrder[] = result.rows.map((row: any) => {
        const eventData = (row.event_data ?? {}) as Record<string, unknown>;
        return {
          orderId: row.event_id,
          subjectLicenseId: asNullableString(eventData.licenseId),
          subjectLicenseNumber: asNullableString(eventData.licenseNumber),
          status: row.event_type === 'PROHIBITION_ORDER_LIFTED' ? 'LIFTED' : 'ACTIVE',
          effectiveAt: row.occurred_at?.toISOString?.() ?? String(row.occurred_at),
          liftedAt: row.event_type === 'PROHIBITION_ORDER_LIFTED'
            ? row.occurred_at?.toISOString?.() ?? String(row.occurred_at)
            : null,
          reason: asNullableString(eventData.reason),
        };
      });

      res.json({
        items,
        count: items.length,
      });
    } catch (error) {
      next(error);
    }
  });

  // Verify by public license number
  router.get('/verify-by-number/:licenseNumber', verifyLimiter, async (req, res, next) => {
    try {
      const { licenseNumber } = req.params;
      const projection = await getLicenseProjectionByNumber(pool, licenseNumber);
      if (!projection) {
        throw new ApiError(404, 'LICENSE_NOT_FOUND', 'License not found');
      }

      return res.json({
        licenseId: projection.licenseId,
        licenseNumber: projection.licenseNumber,
        status: projection.status,
        validUntil: projection.expiresOn,
      });
    } catch (error) {
      next(error);
    }
  });

  // Verify single license (machine-readable)
  router.get('/verify/:licenseId', verifyLimiter, async (req, res, next) => {
    try {
      const { licenseId } = req.params;
      const correlationId = typeof req.query.correlationId === 'string' && isUuid(req.query.correlationId)
        ? req.query.correlationId
        : crypto.randomUUID();
      const projection = await getLicenseProjection(pool, licenseId);
      if (!projection) {
        throw new ApiError(404, 'LICENSE_NOT_FOUND', 'License not found');
      }

      const signedToken = buildSignedToken(projection.licenseId, projection.expiresOn);
      projection.signedToken = signedToken;

      const tokenIssuedEventId = await appendPublicEvent(
        store,
        'LICENSE_VERIFICATION_TOKEN_ISSUED',
        'LICENSE',
        projection.licenseId,
        {
          licenseId: projection.licenseId,
          expiresOn: projection.expiresOn,
          issuerKeyId: VERIFY_TOKEN_ISSUER,
        },
        correlationId
      );

      await appendPublicEvent(
        store,
        'LICENSE_VERIFICATION_PERFORMED',
        'LICENSE',
        projection.licenseId,
        {
          licenseId: projection.licenseId,
          verifierType: 'MACHINE',
          result: projection.status,
        },
        correlationId,
        tokenIssuedEventId
      );

      res.json({
        licenseId: projection.licenseId,
        status: projection.status,
        validUntil: projection.expiresOn,
        signedToken,
      });
    } catch (error) {
      next(error);
    }
  });

  // Stable QR path contract endpoint
  router.get('/v1/l/:licenseId', verifyLimiter, async (req, res, next) => {
    try {
      const { licenseId } = req.params;
      const correlationId = typeof req.query.correlationId === 'string' && isUuid(req.query.correlationId)
        ? req.query.correlationId
        : crypto.randomUUID();
      const projection = await getLicenseProjection(pool, licenseId);
      if (!projection) {
        throw new ApiError(404, 'LICENSE_NOT_FOUND', 'License not found');
      }

      const token = typeof req.query.token === 'string' ? req.query.token : null;
      if (token && !verifySignedToken(projection.licenseId, token)) {
        throw new ApiError(401, 'INVALID_VERIFY_TOKEN', 'Verification token is invalid or expired');
      }

      await appendPublicEvent(
        store,
        'LICENSE_VERIFICATION_PERFORMED',
        'LICENSE',
        projection.licenseId,
        {
          licenseId: projection.licenseId,
          verifierType: 'HUMAN',
          result: projection.status,
        },
        correlationId
      );

      const wantsJson = String(req.headers.accept || '').includes('application/json');
      if (wantsJson) {
        return res.json(projection);
      }

      res.setHeader('content-type', 'text/html; charset=utf-8');
      return res.status(200).send(renderVerifyHtml(projection));
    } catch (error) {
      next(error);
    }
  });

  // Batch verification endpoint
  router.post('/verify/batch', verifyLimiter, async (req, res, next) => {
    try {
      const licenseIds = Array.isArray(req.body?.licenseIds) ? req.body.licenseIds.filter((item: unknown): item is string => typeof item === 'string') : [];
      if (licenseIds.length === 0 || licenseIds.length > 100) {
        throw new ApiError(400, 'INVALID_BATCH_SIZE', 'licenseIds must contain between 1 and 100 IDs');
      }

      const correlationId = typeof req.body?.correlationId === 'string' && isUuid(req.body.correlationId)
        ? req.body.correlationId
        : crypto.randomUUID();
      const partnerId = typeof req.body?.partnerId === 'string' ? req.body.partnerId : 'UNKNOWN_PARTNER';

      const results = await Promise.all(licenseIds.map(async (licenseId: string) => {
        const projection = await getLicenseProjection(pool, licenseId);
        return {
          licenseId,
          found: Boolean(projection),
          status: projection?.status ?? 'NOT_FOUND',
          validUntil: projection?.expiresOn ?? null,
        };
      }));

      const batchAggregateId = crypto.randomUUID();
      const batchEventId = await appendPublicEvent(
        store,
        'MARKETPLACE_BATCH_VERIFICATION_PERFORMED',
        'MARKETPLACE',
        batchAggregateId,
        {
          partnerId,
          licenseIds,
          resultSummary: {
            found: results.filter((item) => item.found).length,
            missing: results.filter((item) => !item.found).length,
          },
        },
        correlationId
      );

      await Promise.all(results
        .filter((item) => item.found)
        .map((item) => appendPublicEvent(
          store,
          'LICENSE_VERIFICATION_PERFORMED',
          'LICENSE',
          item.licenseId,
          {
            licenseId: item.licenseId,
            verifierType: 'BATCH',
            result: item.status,
          },
          correlationId,
          batchEventId
        )));

      res.json({
        results,
        correlationId,
      });
    } catch (error) {
      next(error);
    }
  });

  // Public monthly dashboard (required for public transparency)
  router.get('/dashboard/monthly', registryLimiter, async (req, res, next) => {
    try {
      const month = typeof req.query.month === 'string' && /^\d{4}-\d{2}$/.test(req.query.month)
        ? req.query.month
        : new Date().toISOString().slice(0, 7);
      const snapshot = await buildDashboardSummary(pool, month);
      res.json(snapshot);
    } catch (error) {
      next(error);
    }
  });

  // Public monthly dashboard CSV export
  router.get('/dashboard/monthly/:month.csv', registryLimiter, async (req, res, next) => {
    try {
      const { month } = req.params;
      if (!/^\d{4}-\d{2}$/.test(month)) {
        throw new ApiError(400, 'INVALID_MONTH', 'month must be YYYY-MM');
      }
      const snapshot = await buildDashboardSummary(pool, month);
      const csv = buildDashboardCsv(snapshot);
      res.setHeader('content-type', 'text/csv; charset=utf-8');
      res.setHeader('content-disposition', `attachment; filename="bark-dashboard-${month}.csv"`);
      res.status(200).send(csv);
    } catch (error) {
      next(error);
    }
  });

  // County impounded animal submission endpoint
  router.post('/impounds/submissions', verifyLimiter, async (req, res, next) => {
    try {
      const countyCode = asNullableString(req.body?.countyCode);
      const facilityId = asNullableString(req.body?.facilityId);
      const animals = Array.isArray(req.body?.animals) ? req.body.animals : [];

      if (!countyCode || !facilityId || animals.length === 0) {
        throw new ApiError(400, 'INVALID_IMPOUND_SUBMISSION', 'countyCode, facilityId, and at least one animal are required');
      }

      const correlationId = typeof req.body?.correlationId === 'string' && isUuid(req.body.correlationId)
        ? req.body.correlationId
        : crypto.randomUUID();
      const submissionId = crypto.randomUUID();

      await appendPublicEvent(
        store,
        'IMPOUNDED_ANIMAL_DATA_SUBMITTED',
        'COUNTY_FACILITY',
        facilityId,
        {
          submissionId,
          countyCode,
          facilityId,
          animalCount: animals.length,
          animals,
        },
        correlationId
      );

      res.status(202).json({
        submissionId,
        countyCode,
        facilityId,
        acceptedAnimalCount: animals.length,
        correlationId,
      });
    } catch (error) {
      next(error);
    }
  });

  // Publish transparency snapshot artifact (WVDA use)
  router.post('/transparency/snapshots/publish', async (req, res, next) => {
    try {
      const adminKey = process.env.BARK_TRANSPARENCY_ADMIN_KEY;
      if (!adminKey || req.headers['x-wvda-admin-key'] !== adminKey) {
        throw new ApiError(403, 'FORBIDDEN', 'WVDA admin key required to publish transparency artifacts');
      }

      const snapshotPeriod = typeof req.body?.snapshotPeriod === 'string' && /^\d{4}-\d{2}$/.test(req.body.snapshotPeriod)
        ? req.body.snapshotPeriod
        : new Date().toISOString().slice(0, 7);
      const correlationId = typeof req.body?.correlationId === 'string' && isUuid(req.body.correlationId)
        ? req.body.correlationId
        : crypto.randomUUID();
      const snapshot = await buildSnapshot(pool, snapshotPeriod);
      const serialized = JSON.stringify(snapshot);
      const contentHash = crypto.createHash('sha256').update(serialized, 'utf8').digest('hex');
      const artifactId = crypto.randomUUID();
      const stablePath = `/api/v1/public/transparency/artifacts/${artifactId}`;

      await pool.query(
        `INSERT INTO transparency_artifacts_projection (
          artifact_id,
          artifact_type,
          snapshot_period,
          stable_path,
          content_hash,
          content_json,
          published_at,
          watermark_ingested_at,
          watermark_event_id
        ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, clock_timestamp(), clock_timestamp(), $7::uuid)`,
        [artifactId, 'DASHBOARD_SNAPSHOT', snapshotPeriod, stablePath, contentHash, serialized, crypto.randomUUID()]
      );

      const snapshotEventId = await appendPublicEvent(
        store,
        'DASHBOARD_SNAPSHOT_PUBLISHED',
        'TRANSPARENCY_ARTIFACT',
        artifactId,
        {
          artifactId,
          snapshotPeriod,
          contentHash,
          stablePath,
        },
        correlationId
      );

      await appendPublicEvent(
        store,
        'TRANSPARENCY_ARTIFACT_HASH_ANCHORED',
        'TRANSPARENCY_ARTIFACT',
        artifactId,
        {
          artifactId,
          artifactType: 'DASHBOARD_SNAPSHOT',
          contentHash,
          stablePath,
        },
        correlationId,
        snapshotEventId
      );

      res.status(201).json({
        artifactId,
        snapshotPeriod,
        contentHash,
        stablePath,
      });
    } catch (error) {
      next(error);
    }
  });

  // Retrieve immutable transparency artifact
  router.get('/transparency/artifacts/:artifactId', async (req, res, next) => {
    try {
      const { artifactId } = req.params;
      if (!isUuid(artifactId)) {
        throw new ApiError(400, 'INVALID_ARTIFACT_ID', 'artifactId must be a UUID');
      }

      const result = await pool.query(
        `SELECT artifact_id, snapshot_period, stable_path, content_hash, content_json, published_at
          FROM transparency_artifacts_projection
          WHERE artifact_id = $1::uuid`,
        [artifactId]
      );

      if (result.rows.length === 0) {
        throw new ApiError(404, 'ARTIFACT_NOT_FOUND', 'Transparency artifact not found');
      }

      const row = result.rows[0];
      res.setHeader('x-content-sha256', row.content_hash);
      res.json({
        artifactId: row.artifact_id,
        snapshotPeriod: row.snapshot_period,
        stablePath: row.stable_path,
        contentHash: row.content_hash,
        publishedAt: row.published_at?.toISOString?.() ?? row.published_at,
        snapshot: row.content_json,
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
