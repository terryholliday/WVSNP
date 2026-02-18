import { Router } from 'express';
import { Pool } from 'pg';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import { EventStore } from '../../event-store';
import { IdempotencyService } from '../../application/idempotency-service';
import { validate, validateQuery } from '../middleware/validator';
import { ApiError } from '../middleware/auth';
import {
  accidentalLitterRegistrationAmendSchema,
  accidentalLitterRegistrationSchema,
  breederFilingQuerySchema,
  breederTransferConfirmationAmendSchema,
  breederTransferConfirmationSchema,
  quarterlyTransitionReportAmendSchema,
  quarterlyTransitionReportSchema,
} from '../schemas/public-schemas';

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
const BREEDER_FILING_AGGREGATE_TYPE = 'BREEDER_REPORTING';
const BREEDER_DEADLINE_DUE_SOON_MS = 72 * 60 * 60 * 1000;
const BREEDER_FILING_EVENT_TYPES = [
  'BREEDER_TRANSFER_CONFIRMATION_FILED',
  'BREEDER_TRANSFER_CONFIRMATION_AMENDED',
  'BREEDER_ACCIDENTAL_LITTER_REGISTERED',
  'BREEDER_ACCIDENTAL_LITTER_REGISTRATION_AMENDED',
  'BREEDER_QUARTERLY_TRANSITION_REPORT_FILED',
  'BREEDER_QUARTERLY_TRANSITION_REPORT_AMENDED',
] as const;
const MARKETPLACE_ASSERTION_ISSUER = process.env.BARK_MARKETPLACE_ASSERTION_ISSUER_KEY_ID || 'barkwv-marketplace-v1';
const MARKETPLACE_ASSERTION_SECRET = process.env.BARK_MARKETPLACE_ASSERTION_SECRET || 'dev-bark-marketplace-secret-change-me';
const MARKETPLACE_ASSERTION_TTL_SECONDS = Math.min(Math.max(Number(process.env.BARK_MARKETPLACE_ASSERTION_TTL_SECONDS ?? 300), 60), 3600);
const MARKETPLACE_RATE_LIMIT_FALLBACK = Math.min(Math.max(Number(process.env.BARK_MARKETPLACE_RATE_LIMIT_PER_MINUTE ?? 120), 10), 1000);
const MARKETPLACE_IDEMPOTENCY_TTL_SECONDS = Math.min(Math.max(Number(process.env.BARK_MARKETPLACE_IDEMPOTENCY_TTL_SECONDS ?? 86400), 600), 172800);
const MARKETPLACE_WEBHOOK_TIMEOUT_MS = Math.min(Math.max(Number(process.env.BARK_MARKETPLACE_WEBHOOK_TIMEOUT_MS ?? 5000), 1000), 15000);

const marketplaceRateWindow = new Map<string, { windowStartMs: number; count: number }>();

type BreederFilingType = 'TRANSFER_CONFIRMATION' | 'ACCIDENTAL_LITTER_REGISTRATION' | 'QUARTERLY_TRANSITION_REPORT';
type BreederFilingStatus = 'SUBMITTED' | 'AMENDED';
type BreederDeadlineStatus = 'ON_TIME' | 'DUE_SOON' | 'OVERDUE' | 'CURED';

type LicenseStatus = 'PENDING_REVIEW' | 'ACTIVE' | 'EXPIRED' | 'SUSPENDED' | 'REVOKED';
type MarketplaceDecision = 'ALLOW' | 'BLOCK' | 'REVIEW';
type MarketplaceReasonCode =
  | 'LICENSE_ACTIVE'
  | 'LICENSE_PENDING_REVIEW'
  | 'LICENSE_EXPIRED'
  | 'LICENSE_SUSPENDED'
  | 'LICENSE_REVOKED'
  | 'LICENSE_NOT_FOUND'
  | 'INVALID_LICENSE_REFERENCE';

interface MarketplacePartnerAuth {
  keyId: string;
  partnerId: string;
  scopes: string[];
  webhookSecret: string;
  rateLimitPerMinute: number;
}

interface MarketplaceVerificationInput {
  listingId: string;
  occurredAt?: string;
  licenseId?: string;
  licenseNumber?: string;
}

interface MarketplaceVerificationOutcome {
  listingId: string;
  licenseId: string | null;
  licenseNumber: string | null;
  status: LicenseStatus | 'NOT_FOUND';
  decision: MarketplaceDecision;
  reasonCodes: MarketplaceReasonCode[];
  assertion: {
    assertionId: string;
    token: string;
    issuer: string;
    issuedAt: string;
    expiresAt: string;
  };
}

interface MarketplaceWebhookSubscription {
  subscriptionId: string;
  partnerId: string;
  callbackUrl: string;
  webhookSecret: string;
  eventTypes: string[];
}

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

interface BreederFilingProjection {
  filingId: string;
  filingType: BreederFilingType;
  filingStatus: BreederFilingStatus;
  licenseId: string;
  occurredAt: string;
  dueAt: string;
  ingestedAt: string;
  amendedAt: string | null;
  deadlineStatus: BreederDeadlineStatus;
  transferId: string | null;
  litterId: string | null;
  reportQuarter: string | null;
  payload: Record<string, unknown>;
}

interface DashboardSummary extends TransparencySnapshot {
  month: string;
  inspectionsCompleted: number;
  enforcementActionsFinal: number;
  prohibitionOrdersActive: number;
  impoundSubmissionsLogged: number;
  csvPath: string;
}

interface BreederComplianceFeedItem {
  filingId: string;
  licenseId: string | null;
  filingType: string;
  status: 'ON_TIME' | 'DUE_SOON' | 'OVERDUE' | 'CURED';
  dueAt: string;
  cureDeadlineAt: string | null;
  submittedAt: string | null;
  amendedAt: string | null;
  curedAt: string | null;
  lastEventId: string;
  lastEventIngestedAt: string;
  reportingYear: number | null;
  reportingQuarter: number | null;
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

function asDate(value: string, field: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ApiError(400, 'INVALID_TIMESTAMP', `${field} must be a valid ISO timestamp`);
  }
  return date;
}

function hashRequest(payload: unknown): string {
  return crypto.createHash('sha256').update(stableJsonStringify(payload), 'utf8').digest('hex');
}

function stableJsonStringify(payload: unknown): string {
  if (payload === null || typeof payload !== 'object') {
    return JSON.stringify(payload);
  }
  if (Array.isArray(payload)) {
    return `[${payload.map((item) => stableJsonStringify(item)).join(',')}]`;
  }
  const entries = Object.entries(payload as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, value]) => `${JSON.stringify(key)}:${stableJsonStringify(value)}`).join(',')}}`;
}

function normalizeScopeList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.toUpperCase());
}

function parseOccurredAtOrNow(value: unknown): Date {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return new Date();
  }
  const parsed = asDate(value, 'occurredAt');
  return parsed;
}

function encodeBase64Url(value: string): string {
  return Buffer.from(value, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function decisionForStatus(status: LicenseStatus | 'NOT_FOUND'): { decision: MarketplaceDecision; reasonCodes: MarketplaceReasonCode[] } {
  switch (status) {
    case 'ACTIVE':
      return { decision: 'ALLOW', reasonCodes: ['LICENSE_ACTIVE'] };
    case 'PENDING_REVIEW':
      return { decision: 'REVIEW', reasonCodes: ['LICENSE_PENDING_REVIEW'] };
    case 'EXPIRED':
      return { decision: 'BLOCK', reasonCodes: ['LICENSE_EXPIRED'] };
    case 'SUSPENDED':
      return { decision: 'BLOCK', reasonCodes: ['LICENSE_SUSPENDED'] };
    case 'REVOKED':
      return { decision: 'BLOCK', reasonCodes: ['LICENSE_REVOKED'] };
    case 'NOT_FOUND':
    default:
      return { decision: 'BLOCK', reasonCodes: ['LICENSE_NOT_FOUND'] };
  }
}

function deriveMarketplaceAggregateId(partnerId: string, listingId: string): string {
  const digest = crypto.createHash('sha256').update(`${partnerId}|${listingId}`, 'utf8').digest('hex');
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

function buildMarketplaceAssertion(params: {
  partnerId: string;
  listingId: string;
  licenseId: string | null;
  licenseNumber: string | null;
  status: LicenseStatus | 'NOT_FOUND';
  decision: MarketplaceDecision;
  reasonCodes: MarketplaceReasonCode[];
  occurredAt: Date;
}): MarketplaceVerificationOutcome['assertion'] {
  const assertionId = crypto.randomUUID();
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + MARKETPLACE_ASSERTION_TTL_SECONDS * 1000);
  const payload = {
    assertionId,
    partnerId: params.partnerId,
    listingId: params.listingId,
    licenseId: params.licenseId,
    licenseNumber: params.licenseNumber,
    status: params.status,
    decision: params.decision,
    reasonCodes: params.reasonCodes,
    occurredAt: params.occurredAt.toISOString(),
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
  const encodedPayload = encodeBase64Url(JSON.stringify(payload));
  const signingInput = `${MARKETPLACE_ASSERTION_ISSUER}.${encodedPayload}`;
  const signature = crypto.createHmac('sha256', MARKETPLACE_ASSERTION_SECRET).update(signingInput, 'utf8').digest('hex');
  return {
    assertionId,
    token: `${signingInput}.${signature}`,
    issuer: MARKETPLACE_ASSERTION_ISSUER,
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
}

function signMarketplaceWebhookPayload(webhookSecret: string, timestamp: string, body: string): string {
  return crypto.createHmac('sha256', webhookSecret).update(`${timestamp}.${body}`, 'utf8').digest('hex');
}

function applyMarketplaceRateLimit(partnerId: string, rateLimitPerMinute: number): void {
  const now = Date.now();
  const windowStart = now - (now % 60_000);
  const current = marketplaceRateWindow.get(partnerId);
  if (!current || current.windowStartMs !== windowStart) {
    marketplaceRateWindow.set(partnerId, { windowStartMs: windowStart, count: 1 });
    return;
  }
  if (current.count >= rateLimitPerMinute) {
    throw new ApiError(429, 'MARKETPLACE_RATE_LIMITED', 'Marketplace partner request rate limit exceeded');
  }
  current.count += 1;
  marketplaceRateWindow.set(partnerId, current);
}

async function readMarketplacePartnerAuth(pool: Pool, req: any): Promise<MarketplacePartnerAuth> {
  const authHeader = typeof req.headers?.authorization === 'string' ? req.headers.authorization : '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const altToken = typeof req.headers?.['x-marketplace-key'] === 'string' ? req.headers['x-marketplace-key'].trim() : '';
  const token = bearerToken || altToken;

  if (!token) {
    throw new ApiError(401, 'MISSING_MARKETPLACE_KEY', 'Marketplace API key required');
  }

  const keyHash = crypto.createHash('sha256').update(token, 'utf8').digest('hex');
  const result = await pool.query(
    `SELECT key_id::text,
            partner_id,
            scopes,
            webhook_secret,
            rate_limit_per_minute,
            revoked_at,
            expires_at
       FROM marketplace_partner_api_keys
      WHERE key_hash = $1`,
    [keyHash],
  );

  if (result.rows.length === 0) {
    throw new ApiError(401, 'INVALID_MARKETPLACE_KEY', 'Marketplace API key is invalid');
  }

  const row = result.rows[0];
  if (row.revoked_at) {
    throw new ApiError(401, 'MARKETPLACE_KEY_REVOKED', 'Marketplace API key has been revoked');
  }
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
    throw new ApiError(401, 'MARKETPLACE_KEY_EXPIRED', 'Marketplace API key has expired');
  }

  const scopes = normalizeScopeList(row.scopes);
  if (!scopes.includes('MARKETPLACE_VERIFY')) {
    throw new ApiError(403, 'MISSING_MARKETPLACE_SCOPE', 'Marketplace API key missing MARKETPLACE_VERIFY scope');
  }

  await pool.query(
    `UPDATE marketplace_partner_api_keys
        SET last_used_at = clock_timestamp()
      WHERE key_hash = $1`,
    [keyHash],
  );

  return {
    keyId: row.key_id,
    partnerId: String(row.partner_id),
    scopes,
    webhookSecret: typeof row.webhook_secret === 'string' && row.webhook_secret.length > 0
      ? row.webhook_secret
      : MARKETPLACE_ASSERTION_SECRET,
    rateLimitPerMinute: Number.isFinite(Number(row.rate_limit_per_minute))
      ? Math.max(10, Number(row.rate_limit_per_minute))
      : MARKETPLACE_RATE_LIMIT_FALLBACK,
  };
}

async function withIdempotency<T>(
  pool: Pool,
  idempotency: IdempotencyService,
  operationType: string,
  idempotencyKey: string | null,
  payload: unknown,
  execute: () => Promise<T>,
): Promise<{ response: T; replayed: boolean }> {
  if (!idempotencyKey) {
    return {
      response: await execute(),
      replayed: false,
    };
  }

  const normalizedKey = idempotencyKey.trim();
  if (normalizedKey.length < 8 || normalizedKey.length > 255) {
    throw new ApiError(400, 'INVALID_IDEMPOTENCY_KEY', 'Idempotency-Key must be between 8 and 255 chars');
  }

  const requestHash = hashRequest(payload);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query(
      `SELECT operation_type, request_hash, status, response_json
         FROM idempotency_cache
        WHERE idempotency_key = $1
        FOR UPDATE`,
      [normalizedKey],
    );

    if (existing.rows.length > 0) {
      const row = existing.rows[0];
      if (row.operation_type !== operationType || row.request_hash !== requestHash) {
        throw new ApiError(409, 'IDEMPOTENCY_PAYLOAD_MISMATCH', 'Idempotency-Key already used with a different payload');
      }
    }

    const status = await idempotency.checkAndReserve(
      client,
      normalizedKey,
      operationType,
      requestHash,
      MARKETPLACE_IDEMPOTENCY_TTL_SECONDS,
    );

    if (status === 'COMPLETED') {
      const replaySource = existing.rows[0]?.response_json
        ? existing.rows[0]
        : (
          await client.query(
            `SELECT response_json
               FROM idempotency_cache
              WHERE idempotency_key = $1`,
            [normalizedKey],
          )
        ).rows[0];
      if (!replaySource?.response_json) {
        throw new ApiError(409, 'IDEMPOTENCY_CACHE_CORRUPTED', 'Completed idempotency record missing response payload');
      }
      await client.query('COMMIT');
      return {
        response: replaySource.response_json as T,
        replayed: true,
      };
    }

    if (status === 'PROCESSING') {
      throw new ApiError(409, 'IDEMPOTENCY_IN_PROGRESS', 'Request is already processing for this key');
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  try {
    const response = await execute();
    const recordClient = await pool.connect();
    try {
      await recordClient.query('BEGIN');
      await idempotency.recordResult(recordClient, normalizedKey, response);
      await recordClient.query('COMMIT');
    } catch (error) {
      await recordClient.query('ROLLBACK');
      throw error;
    } finally {
      recordClient.release();
    }

    return {
      response,
      replayed: false,
    };
  } catch (error) {
    const failureClient = await pool.connect();
    try {
      await failureClient.query('BEGIN');
      await idempotency.recordFailure(failureClient, normalizedKey);
      await failureClient.query('COMMIT');
    } catch {
      await failureClient.query('ROLLBACK');
    } finally {
      failureClient.release();
    }

    throw error;
  }
}

function computeDueAt(
  filingType: BreederFilingType,
  occurredAt: Date,
  explicitDueAt?: Date | null
): Date {
  if (filingType === 'TRANSFER_CONFIRMATION') {
    return new Date(occurredAt.getTime() + 7 * 24 * 60 * 60 * 1000);
  }
  if (filingType === 'ACCIDENTAL_LITTER_REGISTRATION') {
    return new Date(occurredAt.getTime() + 14 * 24 * 60 * 60 * 1000);
  }
  if (!explicitDueAt) {
    throw new ApiError(400, 'MISSING_REPORT_DUE_AT', 'Quarterly transition reports require reportDueAt');
  }
  return explicitDueAt;
}

function computeDeadlineStatus(
  dueAt: Date,
  now: Date,
  filingStatus: BreederFilingStatus,
  lastIngestedAt: Date
): BreederDeadlineStatus {
  if (lastIngestedAt.getTime() > dueAt.getTime() && filingStatus === 'AMENDED') {
    return 'CURED';
  }
  if (now.getTime() > dueAt.getTime()) {
    return 'OVERDUE';
  }
  if (dueAt.getTime() - now.getTime() <= BREEDER_DEADLINE_DUE_SOON_MS) {
    return 'DUE_SOON';
  }
  return 'ON_TIME';
}

function toIso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}

function isBreederFilingType(value: unknown): value is BreederFilingType {
  return value === 'TRANSFER_CONFIRMATION'
    || value === 'ACCIDENTAL_LITTER_REGISTRATION'
    || value === 'QUARTERLY_TRANSITION_REPORT';
}

function isBreederFilingStatus(value: unknown): value is BreederFilingStatus {
  return value === 'SUBMITTED' || value === 'AMENDED';
}

function eventTypeToFilingType(eventType: string): BreederFilingType {
  if (eventType.includes('ACCIDENTAL_LITTER')) {
    return 'ACCIDENTAL_LITTER_REGISTRATION';
  }
  if (eventType.includes('QUARTERLY_TRANSITION')) {
    return 'QUARTERLY_TRANSITION_REPORT';
  }
  return 'TRANSFER_CONFIRMATION';
}

function eventTypeToFilingStatus(eventType: string): BreederFilingStatus {
  return eventType.endsWith('_AMENDED') ? 'AMENDED' : 'SUBMITTED';
}

function buildBreederEventType(filingType: BreederFilingType, filingStatus: BreederFilingStatus): string {
  if (filingType === 'TRANSFER_CONFIRMATION') {
    return filingStatus === 'AMENDED'
      ? 'BREEDER_TRANSFER_CONFIRMATION_AMENDED'
      : 'BREEDER_TRANSFER_CONFIRMATION_FILED';
  }
  if (filingType === 'ACCIDENTAL_LITTER_REGISTRATION') {
    return filingStatus === 'AMENDED'
      ? 'BREEDER_ACCIDENTAL_LITTER_REGISTRATION_AMENDED'
      : 'BREEDER_ACCIDENTAL_LITTER_REGISTERED';
  }
  return filingStatus === 'AMENDED'
    ? 'BREEDER_QUARTERLY_TRANSITION_REPORT_AMENDED'
    : 'BREEDER_QUARTERLY_TRANSITION_REPORT_FILED';
}

function quarterToParts(reportQuarter: string | null): { reportingYear: number | null; reportingQuarter: number | null } {
  if (!reportQuarter) {
    return { reportingYear: null, reportingQuarter: null };
  }
  const match = /^(\d{4})-Q([1-4])$/.exec(reportQuarter);
  if (!match) {
    return { reportingYear: null, reportingQuarter: null };
  }
  return {
    reportingYear: Number(match[1]),
    reportingQuarter: Number(match[2]),
  };
}

function projectBreederFiling(row: any, now: Date): BreederFilingProjection {
  const eventData = (row.event_data ?? {}) as Record<string, unknown>;
  const filingTypeValue = asNullableString(eventData.filingType);
  const filingStatusValue = asNullableString(eventData.filingStatus);
  const filingType = filingTypeValue && isBreederFilingType(filingTypeValue)
    ? filingTypeValue
    : eventTypeToFilingType(String(row.event_type));
  const filingStatus = filingStatusValue && isBreederFilingStatus(filingStatusValue)
    ? filingStatusValue
    : eventTypeToFilingStatus(String(row.event_type));
  const dueAt = asDate(asNullableString(eventData.dueAt) ?? toIso(row.occurred_at), 'dueAt');
  const ingestedAt = row.ingested_at instanceof Date ? row.ingested_at : new Date(String(row.ingested_at));
  const payloadValue = eventData.payload;
  const payload = payloadValue && typeof payloadValue === 'object' && !Array.isArray(payloadValue)
    ? payloadValue as Record<string, unknown>
    : {};

  return {
    filingId: row.filing_id,
    filingType,
    filingStatus,
    licenseId: asNullableString(eventData.licenseId) ?? '',
    occurredAt: toIso(eventData.occurredAt ?? row.occurred_at),
    dueAt: dueAt.toISOString(),
    ingestedAt: ingestedAt.toISOString(),
    amendedAt: filingStatus === 'AMENDED' ? asNullableString(eventData.amendedAt) ?? ingestedAt.toISOString() : null,
    deadlineStatus: computeDeadlineStatus(dueAt, now, filingStatus, ingestedAt),
    transferId: asNullableString(eventData.transferId),
    litterId: asNullableString(eventData.litterId),
    reportQuarter: asNullableString(eventData.reportQuarter),
    payload,
  };
}

async function getLatestBreederFilingRow(pool: Pool, filingId: string): Promise<any | null> {
  const result = await pool.query(
    `SELECT event_id::text,
            aggregate_id::text AS filing_id,
            event_type,
            event_data,
            occurred_at,
            ingested_at
       FROM event_log
      WHERE aggregate_type = $1
        AND event_type = ANY($2::text[])
        AND aggregate_id = $3::uuid
      ORDER BY ingested_at DESC, event_id DESC
      LIMIT 1`,
    [BREEDER_FILING_AGGREGATE_TYPE, BREEDER_FILING_EVENT_TYPES, filingId],
  );
  return result.rows[0] ?? null;
}

async function getBreederFilingProjection(pool: Pool, filingId: string): Promise<BreederFilingProjection | null> {
  if (!isUuid(filingId)) {
    return null;
  }
  const row = await getLatestBreederFilingRow(pool, filingId);
  return row ? projectBreederFiling(row, new Date()) : null;
}

async function listBreederFilingProjections(
  pool: Pool,
  options: {
    licenseId?: string;
    filingStatus?: BreederFilingStatus;
    filingType?: BreederFilingType;
    limit?: number;
  },
): Promise<BreederFilingProjection[]> {
  const limit = Math.min(options.limit ?? 50, 200);
  const result = await pool.query(
    `SELECT DISTINCT ON (aggregate_id)
        aggregate_id::text AS filing_id,
        event_type,
        event_data,
        occurred_at,
        ingested_at
      FROM event_log
      WHERE aggregate_type = $1
        AND event_type = ANY($2::text[])
        AND ($3::text IS NULL OR event_data->>'licenseId' = $3::text)
        AND ($4::text IS NULL OR event_data->>'filingStatus' = $4::text)
        AND ($5::text IS NULL OR event_data->>'filingType' = $5::text)
      ORDER BY aggregate_id, ingested_at DESC, event_id DESC
      LIMIT $6`,
    [
      BREEDER_FILING_AGGREGATE_TYPE,
      BREEDER_FILING_EVENT_TYPES,
      options.licenseId ?? null,
      options.filingStatus ?? null,
      options.filingType ?? null,
      limit,
    ],
  );
  return result.rows.map((row: any) => projectBreederFiling(row, new Date()));
}

async function upsertBreederComplianceProjection(
  pool: Pool,
  input: {
    filingId: string;
    licenseId: string;
    filingType: BreederFilingType;
    filingStatus: BreederFilingStatus;
    reportQuarter: string | null;
    occurredAt: Date;
    dueAt: Date;
    lastEventId: string;
    lastEventIngestedAt: Date;
  },
): Promise<void> {
  const deadlineStatus = computeDeadlineStatus(input.dueAt, new Date(), input.filingStatus, input.lastEventIngestedAt);
  const { reportingYear, reportingQuarter } = quarterToParts(input.reportQuarter);
  const cureDeadlineAt = deadlineStatus === 'OVERDUE'
    ? new Date(input.dueAt.getTime() + 7 * 24 * 60 * 60 * 1000)
    : null;
  const submittedAt = input.filingStatus === 'SUBMITTED' ? input.lastEventIngestedAt : null;
  const amendedAt = input.filingStatus === 'AMENDED' ? input.lastEventIngestedAt : null;
  const curedAt = deadlineStatus === 'CURED' ? input.lastEventIngestedAt : null;

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
     ) VALUES (
       $1::uuid,
       $2::uuid,
       $3,
       $4,
       $5,
       $6,
       $7,
       $8,
       $9,
       $10,
       $11,
       $12,
       $13,
       $14::uuid,
       $15,
       clock_timestamp(),
       $15,
       $14::uuid
     )
     ON CONFLICT (filing_id) DO UPDATE
     SET license_id = EXCLUDED.license_id,
         grant_cycle_id = EXCLUDED.grant_cycle_id,
         filing_type = EXCLUDED.filing_type,
         reporting_year = EXCLUDED.reporting_year,
         reporting_quarter = EXCLUDED.reporting_quarter,
         occurred_at = EXCLUDED.occurred_at,
         due_at = EXCLUDED.due_at,
         cure_deadline_at = EXCLUDED.cure_deadline_at,
         submitted_at = COALESCE(breeder_compliance_queue_projection.submitted_at, EXCLUDED.submitted_at),
         amended_at = COALESCE(EXCLUDED.amended_at, breeder_compliance_queue_projection.amended_at),
         cured_at = COALESCE(EXCLUDED.cured_at, breeder_compliance_queue_projection.cured_at),
         status = EXCLUDED.status,
         last_event_id = EXCLUDED.last_event_id,
         last_event_ingested_at = EXCLUDED.last_event_ingested_at,
         rebuilt_at = clock_timestamp(),
         watermark_ingested_at = EXCLUDED.watermark_ingested_at,
         watermark_event_id = EXCLUDED.watermark_event_id`,
    [
      input.filingId,
      input.licenseId,
      DEFAULT_GRANT_CYCLE_ID,
      input.filingType,
      reportingYear,
      reportingQuarter,
      input.occurredAt.toISOString(),
      input.dueAt.toISOString(),
      cureDeadlineAt?.toISOString() ?? null,
      submittedAt?.toISOString() ?? null,
      amendedAt?.toISOString() ?? null,
      curedAt?.toISOString() ?? null,
      deadlineStatus,
      input.lastEventId,
      input.lastEventIngestedAt.toISOString(),
    ],
  );
}

async function appendBreederFilingMutation(
  pool: Pool,
  store: EventStore,
  input: {
    filingId: string;
    filingType: BreederFilingType;
    filingStatus: BreederFilingStatus;
    licenseId: string;
    occurredAt: Date;
    dueAt: Date;
    correlationId: string;
    causationId?: string | null;
    transferId?: string | null;
    litterId?: string | null;
    reportQuarter?: string | null;
    payload: Record<string, unknown>;
  },
): Promise<{ eventId: string; projection: BreederFilingProjection }> {
  const eventType = buildBreederEventType(input.filingType, input.filingStatus);
  const eventData: Record<string, unknown> = {
    filingId: input.filingId,
    filingType: input.filingType,
    filingStatus: input.filingStatus,
    licenseId: input.licenseId,
    occurredAt: input.occurredAt.toISOString(),
    dueAt: input.dueAt.toISOString(),
    transferId: input.transferId ?? null,
    litterId: input.litterId ?? null,
    reportQuarter: input.reportQuarter ?? null,
    amendedAt: input.filingStatus === 'AMENDED' ? new Date().toISOString() : null,
    payload: input.payload,
  };

  const eventId = await appendPublicEvent(
    store,
    eventType,
    BREEDER_FILING_AGGREGATE_TYPE,
    input.filingId,
    eventData,
    input.correlationId,
    input.causationId ?? null,
    input.occurredAt,
  );

  const ingestedAtResult = await pool.query(
    `SELECT ingested_at
       FROM event_log
      WHERE event_id = $1::uuid`,
    [eventId],
  );
  const ingestedAt = ingestedAtResult.rows[0]?.ingested_at instanceof Date
    ? ingestedAtResult.rows[0].ingested_at
    : new Date(String(ingestedAtResult.rows[0]?.ingested_at ?? new Date().toISOString()));

  await upsertBreederComplianceProjection(pool, {
    filingId: input.filingId,
    licenseId: input.licenseId,
    filingType: input.filingType,
    filingStatus: input.filingStatus,
    reportQuarter: input.reportQuarter ?? null,
    occurredAt: input.occurredAt,
    dueAt: input.dueAt,
    lastEventId: eventId,
    lastEventIngestedAt: ingestedAt,
  });

  const projection = await getBreederFilingProjection(pool, input.filingId);
  if (!projection) {
    throw new ApiError(500, 'BREEDER_FILING_PROJECTION_MISSING', 'Failed to materialize breeder filing projection');
  }

  return {
    eventId,
    projection,
  };
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
  causationId: string | null = null,
  occurredAt: Date = new Date(),
): Promise<string> {
  const eventId = EventStore.newEventId();
  await store.append({
    eventId,
    aggregateType,
    aggregateId,
    eventType,
    eventData,
    occurredAt,
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

async function getLatestMarketplaceListingDecision(
  pool: Pool,
  partnerId: string,
  listingId: string,
): Promise<{ status: LicenseStatus | 'NOT_FOUND'; decision: MarketplaceDecision } | null> {
  const result = await pool.query(
    `SELECT event_data
       FROM event_log
      WHERE event_type = 'MARKETPLACE_LISTING_VERIFIED'
        AND event_data->>'partnerId' = $1
        AND event_data->>'listingId' = $2
      ORDER BY ingested_at DESC, event_id DESC
      LIMIT 1`,
    [partnerId, listingId],
  );

  if (result.rows.length === 0) {
    return null;
  }

  const data = (result.rows[0].event_data ?? {}) as Record<string, unknown>;
  const status = typeof data.status === 'string' ? data.status : null;
  const decision = typeof data.decision === 'string' ? data.decision : null;
  if (
    (status === 'ACTIVE' || status === 'PENDING_REVIEW' || status === 'EXPIRED' || status === 'SUSPENDED' || status === 'REVOKED' || status === 'NOT_FOUND')
    && (decision === 'ALLOW' || decision === 'BLOCK' || decision === 'REVIEW')
  ) {
    return {
      status,
      decision,
    };
  }

  return null;
}

async function getActiveMarketplaceWebhookSubscriptions(
  pool: Pool,
  partnerId: string,
): Promise<MarketplaceWebhookSubscription[]> {
  const result = await pool.query(
    `SELECT subscription_id::text,
            partner_id,
            callback_url,
            webhook_secret,
            event_types
       FROM marketplace_partner_webhooks
      WHERE partner_id = $1
        AND status = 'ACTIVE'`,
    [partnerId],
  );

  return result.rows
    .map((row) => ({
      subscriptionId: row.subscription_id,
      partnerId: row.partner_id,
      callbackUrl: row.callback_url,
      webhookSecret: row.webhook_secret,
      eventTypes: normalizeScopeList(row.event_types),
    }))
    .filter((item) => item.eventTypes.length === 0 || item.eventTypes.includes('MARKETPLACE_LICENSE_STATUS_DRIFT_DETECTED'));
}

async function dispatchMarketplaceStatusDriftWebhooks(
  pool: Pool,
  store: EventStore,
  correlationId: string,
  driftEventId: string,
  subscriptions: MarketplaceWebhookSubscription[],
  payload: Record<string, unknown>,
): Promise<void> {
  const body = JSON.stringify(payload);
  await Promise.all(subscriptions.map(async (subscription) => {
    const deliveryId = crypto.randomUUID();
    const timestamp = new Date().toISOString();
    const signature = signMarketplaceWebhookPayload(subscription.webhookSecret, timestamp, body);
    let deliveryStatus: 'DELIVERED' | 'FAILED' = 'FAILED';
    let responseCode: number | null = null;
    let responseBody: string | null = null;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), MARKETPLACE_WEBHOOK_TIMEOUT_MS);
      try {
        const response = await (globalThis.fetch as any)(subscription.callbackUrl, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-marketplace-webhook-event': 'MARKETPLACE_LICENSE_STATUS_DRIFT_DETECTED',
            'x-marketplace-webhook-delivery-id': deliveryId,
            'x-marketplace-webhook-subscription-id': subscription.subscriptionId,
            'x-marketplace-webhook-timestamp': timestamp,
            'x-marketplace-webhook-signature': signature,
          },
          body,
          signal: controller.signal,
        });
        responseCode = Number(response.status);
        responseBody = await response.text();
        deliveryStatus = response.ok ? 'DELIVERED' : 'FAILED';
      } finally {
        clearTimeout(timeout);
      }
    } catch (error) {
      responseBody = error instanceof Error ? error.message : 'WEBHOOK_DELIVERY_FAILED';
    }

    await pool.query(
      `INSERT INTO marketplace_webhook_deliveries (
         delivery_id,
         subscription_id,
         partner_id,
         event_type,
         payload,
         signature,
         delivered_at,
         status,
         response_code,
         response_body
       ) VALUES ($1::uuid, $2::uuid, $3, $4, $5::jsonb, $6, clock_timestamp(), $7, $8, $9)`,
      [
        deliveryId,
        subscription.subscriptionId,
        subscription.partnerId,
        'MARKETPLACE_LICENSE_STATUS_DRIFT_DETECTED',
        body,
        signature,
        deliveryStatus,
        responseCode,
        responseBody,
      ],
    );

    await appendPublicEvent(
      store,
      'MARKETPLACE_WEBHOOK_DELIVERY_RECORDED',
      'MARKETPLACE_WEBHOOK',
      deliveryId,
      {
        deliveryId,
        subscriptionId: subscription.subscriptionId,
        partnerId: subscription.partnerId,
        eventType: 'MARKETPLACE_LICENSE_STATUS_DRIFT_DETECTED',
        status: deliveryStatus,
        responseCode,
      },
      correlationId,
      driftEventId,
    );
  }));
}

async function resolveMarketplaceVerification(
  pool: Pool,
  input: MarketplaceVerificationInput,
): Promise<{ licenseId: string | null; licenseNumber: string | null; status: LicenseStatus | 'NOT_FOUND'; reasonCodeOverride: MarketplaceReasonCode | null }> {
  if (typeof input.licenseId === 'string' && input.licenseId.trim().length > 0) {
    if (!isUuid(input.licenseId)) {
      return {
        licenseId: null,
        licenseNumber: null,
        status: 'NOT_FOUND',
        reasonCodeOverride: 'INVALID_LICENSE_REFERENCE',
      };
    }

    const projection = await getLicenseProjection(pool, input.licenseId);
    if (!projection) {
      return {
        licenseId: input.licenseId,
        licenseNumber: null,
        status: 'NOT_FOUND',
        reasonCodeOverride: null,
      };
    }

    return {
      licenseId: projection.licenseId,
      licenseNumber: projection.licenseNumber,
      status: projection.status,
      reasonCodeOverride: null,
    };
  }

  if (typeof input.licenseNumber === 'string' && input.licenseNumber.trim().length > 0) {
    const projection = await getLicenseProjectionByNumber(pool, input.licenseNumber);
    if (!projection) {
      return {
        licenseId: null,
        licenseNumber: input.licenseNumber,
        status: 'NOT_FOUND',
        reasonCodeOverride: null,
      };
    }

    return {
      licenseId: projection.licenseId,
      licenseNumber: projection.licenseNumber,
      status: projection.status,
      reasonCodeOverride: null,
    };
  }

  return {
    licenseId: null,
    licenseNumber: null,
    status: 'NOT_FOUND',
    reasonCodeOverride: 'INVALID_LICENSE_REFERENCE',
  };
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

export function createPublicRoutes(pool: Pool, store: EventStore, idempotency: IdempotencyService) {
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

  const marketplaceLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: MARKETPLACE_RATE_LIMIT_FALLBACK,
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

  router.post('/breeder/filings/transfer-confirmation', verifyLimiter, validate(breederTransferConfirmationSchema), async (req, res, next) => {
    try {
      const occurredAt = asDate(req.body.occurredAt, 'occurredAt');
      const correlationId = typeof req.body.correlationId === 'string' && isUuid(req.body.correlationId)
        ? req.body.correlationId
        : crypto.randomUUID();
      const idempotencyKey = typeof req.headers['idempotency-key'] === 'string'
        ? req.headers['idempotency-key']
        : null;
      const dueAt = computeDueAt('TRANSFER_CONFIRMATION', occurredAt);

      const { response, replayed } = await withIdempotency(
        pool,
        idempotency,
        'BREEDER_TRANSFER_CONFIRMATION_FILE',
        idempotencyKey,
        {
          endpoint: 'BREEDER_TRANSFER_CONFIRMATION_FILE',
          body: req.body,
        },
        async () => {
          const filingId = crypto.randomUUID();
          const mutation = await appendBreederFilingMutation(pool, store, {
            filingId,
            filingType: 'TRANSFER_CONFIRMATION',
            filingStatus: 'SUBMITTED',
            licenseId: req.body.licenseId,
            occurredAt,
            dueAt,
            correlationId,
            transferId: req.body.transferId,
            payload: {
              transferId: req.body.transferId,
              microchipId: req.body.microchipId ?? null,
              animalCount: req.body.animalCount,
              notes: req.body.notes ?? null,
            },
          });
          return {
            filingId,
            correlationId,
            eventId: mutation.eventId,
            filing: mutation.projection,
          };
        },
      );

      res.status(replayed ? 200 : 201).json({ ...response, replayed });
    } catch (error) {
      next(error);
    }
  });

  router.post('/breeder/filings/:filingId/transfer-confirmation/amend', verifyLimiter, validate(breederTransferConfirmationAmendSchema), async (req, res, next) => {
    try {
      const { filingId } = req.params;
      if (!isUuid(filingId)) {
        throw new ApiError(400, 'INVALID_FILING_ID', 'filingId must be a UUID');
      }

      const occurredAt = asDate(req.body.occurredAt, 'occurredAt');
      const correlationId = typeof req.body.correlationId === 'string' && isUuid(req.body.correlationId)
        ? req.body.correlationId
        : crypto.randomUUID();
      const idempotencyKey = typeof req.headers['idempotency-key'] === 'string'
        ? req.headers['idempotency-key']
        : null;

      const { response, replayed } = await withIdempotency(
        pool,
        idempotency,
        'BREEDER_TRANSFER_CONFIRMATION_AMEND',
        idempotencyKey,
        {
          endpoint: 'BREEDER_TRANSFER_CONFIRMATION_AMEND',
          filingId,
          body: req.body,
        },
        async () => {
          const latest = await getLatestBreederFilingRow(pool, filingId);
          if (!latest) {
            throw new ApiError(404, 'BREEDER_FILING_NOT_FOUND', 'Breeder filing not found');
          }
          const prior = projectBreederFiling(latest, new Date());
          if (prior.filingType !== 'TRANSFER_CONFIRMATION') {
            throw new ApiError(409, 'BREEDER_FILING_TYPE_MISMATCH', 'Filing is not a transfer confirmation report');
          }

          const mutation = await appendBreederFilingMutation(pool, store, {
            filingId,
            filingType: 'TRANSFER_CONFIRMATION',
            filingStatus: 'AMENDED',
            licenseId: prior.licenseId,
            occurredAt,
            dueAt: asDate(prior.dueAt, 'dueAt'),
            correlationId,
            causationId: latest.event_id,
            transferId: req.body.transferId,
            payload: {
              transferId: req.body.transferId,
              microchipId: req.body.microchipId ?? null,
              animalCount: req.body.animalCount,
              notes: req.body.notes ?? null,
            },
          });

          return {
            filingId,
            correlationId,
            eventId: mutation.eventId,
            filing: mutation.projection,
          };
        },
      );

      res.json({ ...response, replayed });
    } catch (error) {
      next(error);
    }
  });

  router.post('/breeder/filings/accidental-litter-registration', verifyLimiter, validate(accidentalLitterRegistrationSchema), async (req, res, next) => {
    try {
      const occurredAt = asDate(req.body.occurredAt, 'occurredAt');
      const correlationId = typeof req.body.correlationId === 'string' && isUuid(req.body.correlationId)
        ? req.body.correlationId
        : crypto.randomUUID();
      const idempotencyKey = typeof req.headers['idempotency-key'] === 'string'
        ? req.headers['idempotency-key']
        : null;
      const dueAt = computeDueAt('ACCIDENTAL_LITTER_REGISTRATION', occurredAt);

      const { response, replayed } = await withIdempotency(
        pool,
        idempotency,
        'BREEDER_ACCIDENTAL_LITTER_FILE',
        idempotencyKey,
        {
          endpoint: 'BREEDER_ACCIDENTAL_LITTER_FILE',
          body: req.body,
        },
        async () => {
          const filingId = crypto.randomUUID();
          const mutation = await appendBreederFilingMutation(pool, store, {
            filingId,
            filingType: 'ACCIDENTAL_LITTER_REGISTRATION',
            filingStatus: 'SUBMITTED',
            licenseId: req.body.licenseId,
            occurredAt,
            dueAt,
            correlationId,
            litterId: req.body.litterId,
            payload: {
              litterId: req.body.litterId,
              litterSize: req.body.litterSize,
              sireId: req.body.sireId ?? null,
              damId: req.body.damId ?? null,
              notes: req.body.notes ?? null,
            },
          });
          return {
            filingId,
            correlationId,
            eventId: mutation.eventId,
            filing: mutation.projection,
          };
        },
      );

      res.status(replayed ? 200 : 201).json({ ...response, replayed });
    } catch (error) {
      next(error);
    }
  });

  router.post('/breeder/filings/:filingId/accidental-litter-registration/amend', verifyLimiter, validate(accidentalLitterRegistrationAmendSchema), async (req, res, next) => {
    try {
      const { filingId } = req.params;
      if (!isUuid(filingId)) {
        throw new ApiError(400, 'INVALID_FILING_ID', 'filingId must be a UUID');
      }

      const occurredAt = asDate(req.body.occurredAt, 'occurredAt');
      const correlationId = typeof req.body.correlationId === 'string' && isUuid(req.body.correlationId)
        ? req.body.correlationId
        : crypto.randomUUID();
      const idempotencyKey = typeof req.headers['idempotency-key'] === 'string'
        ? req.headers['idempotency-key']
        : null;

      const { response, replayed } = await withIdempotency(
        pool,
        idempotency,
        'BREEDER_ACCIDENTAL_LITTER_AMEND',
        idempotencyKey,
        {
          endpoint: 'BREEDER_ACCIDENTAL_LITTER_AMEND',
          filingId,
          body: req.body,
        },
        async () => {
          const latest = await getLatestBreederFilingRow(pool, filingId);
          if (!latest) {
            throw new ApiError(404, 'BREEDER_FILING_NOT_FOUND', 'Breeder filing not found');
          }
          const prior = projectBreederFiling(latest, new Date());
          if (prior.filingType !== 'ACCIDENTAL_LITTER_REGISTRATION') {
            throw new ApiError(409, 'BREEDER_FILING_TYPE_MISMATCH', 'Filing is not an accidental litter registration');
          }

          const mutation = await appendBreederFilingMutation(pool, store, {
            filingId,
            filingType: 'ACCIDENTAL_LITTER_REGISTRATION',
            filingStatus: 'AMENDED',
            licenseId: prior.licenseId,
            occurredAt,
            dueAt: asDate(prior.dueAt, 'dueAt'),
            correlationId,
            causationId: latest.event_id,
            litterId: req.body.litterId,
            payload: {
              litterId: req.body.litterId,
              litterSize: req.body.litterSize,
              sireId: req.body.sireId ?? null,
              damId: req.body.damId ?? null,
              notes: req.body.notes ?? null,
            },
          });

          return {
            filingId,
            correlationId,
            eventId: mutation.eventId,
            filing: mutation.projection,
          };
        },
      );

      res.json({ ...response, replayed });
    } catch (error) {
      next(error);
    }
  });

  router.post('/breeder/filings/quarterly-transition-report', verifyLimiter, validate(quarterlyTransitionReportSchema), async (req, res, next) => {
    try {
      const occurredAt = asDate(req.body.occurredAt, 'occurredAt');
      const reportDueAt = asDate(req.body.reportDueAt, 'reportDueAt');
      const correlationId = typeof req.body.correlationId === 'string' && isUuid(req.body.correlationId)
        ? req.body.correlationId
        : crypto.randomUUID();
      const idempotencyKey = typeof req.headers['idempotency-key'] === 'string'
        ? req.headers['idempotency-key']
        : null;
      const dueAt = computeDueAt('QUARTERLY_TRANSITION_REPORT', occurredAt, reportDueAt);

      const { response, replayed } = await withIdempotency(
        pool,
        idempotency,
        'BREEDER_QUARTERLY_TRANSITION_FILE',
        idempotencyKey,
        {
          endpoint: 'BREEDER_QUARTERLY_TRANSITION_FILE',
          body: req.body,
        },
        async () => {
          const filingId = crypto.randomUUID();
          const mutation = await appendBreederFilingMutation(pool, store, {
            filingId,
            filingType: 'QUARTERLY_TRANSITION_REPORT',
            filingStatus: 'SUBMITTED',
            licenseId: req.body.licenseId,
            occurredAt,
            dueAt,
            correlationId,
            reportQuarter: req.body.reportQuarter,
            payload: {
              reportQuarter: req.body.reportQuarter,
              maintainedBreedingDogs: req.body.maintainedBreedingDogs,
              transfersCompleted: req.body.transfersCompleted,
              reportDueAt: req.body.reportDueAt,
              notes: req.body.notes ?? null,
            },
          });
          return {
            filingId,
            correlationId,
            eventId: mutation.eventId,
            filing: mutation.projection,
          };
        },
      );

      res.status(replayed ? 200 : 201).json({ ...response, replayed });
    } catch (error) {
      next(error);
    }
  });

  router.post('/breeder/filings/:filingId/quarterly-transition-report/amend', verifyLimiter, validate(quarterlyTransitionReportAmendSchema), async (req, res, next) => {
    try {
      const { filingId } = req.params;
      if (!isUuid(filingId)) {
        throw new ApiError(400, 'INVALID_FILING_ID', 'filingId must be a UUID');
      }

      const occurredAt = asDate(req.body.occurredAt, 'occurredAt');
      const correlationId = typeof req.body.correlationId === 'string' && isUuid(req.body.correlationId)
        ? req.body.correlationId
        : crypto.randomUUID();
      const idempotencyKey = typeof req.headers['idempotency-key'] === 'string'
        ? req.headers['idempotency-key']
        : null;

      const { response, replayed } = await withIdempotency(
        pool,
        idempotency,
        'BREEDER_QUARTERLY_TRANSITION_AMEND',
        idempotencyKey,
        {
          endpoint: 'BREEDER_QUARTERLY_TRANSITION_AMEND',
          filingId,
          body: req.body,
        },
        async () => {
          const latest = await getLatestBreederFilingRow(pool, filingId);
          if (!latest) {
            throw new ApiError(404, 'BREEDER_FILING_NOT_FOUND', 'Breeder filing not found');
          }
          const prior = projectBreederFiling(latest, new Date());
          if (prior.filingType !== 'QUARTERLY_TRANSITION_REPORT') {
            throw new ApiError(409, 'BREEDER_FILING_TYPE_MISMATCH', 'Filing is not a quarterly transition report');
          }

          const mutation = await appendBreederFilingMutation(pool, store, {
            filingId,
            filingType: 'QUARTERLY_TRANSITION_REPORT',
            filingStatus: 'AMENDED',
            licenseId: prior.licenseId,
            occurredAt,
            dueAt: asDate(prior.dueAt, 'dueAt'),
            correlationId,
            causationId: latest.event_id,
            reportQuarter: req.body.reportQuarter,
            payload: {
              reportQuarter: req.body.reportQuarter,
              maintainedBreedingDogs: req.body.maintainedBreedingDogs,
              transfersCompleted: req.body.transfersCompleted,
              reportDueAt: req.body.reportDueAt,
              notes: req.body.notes ?? null,
            },
          });

          return {
            filingId,
            correlationId,
            eventId: mutation.eventId,
            filing: mutation.projection,
          };
        },
      );

      res.json({ ...response, replayed });
    } catch (error) {
      next(error);
    }
  });

  router.get('/breeder/filings', registryLimiter, validateQuery(breederFilingQuerySchema), async (req, res, next) => {
    try {
      const items = await listBreederFilingProjections(pool, {
        licenseId: typeof req.query.licenseId === 'string' ? req.query.licenseId : undefined,
        filingStatus: isBreederFilingStatus(req.query.filingStatus) ? req.query.filingStatus : undefined,
        filingType: isBreederFilingType(req.query.filingType) ? req.query.filingType : undefined,
        limit: typeof req.query.limit === 'number' ? req.query.limit : Number(req.query.limit ?? 50),
      });

      res.json({
        items,
        count: items.length,
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/breeder/filings/:filingId', registryLimiter, async (req, res, next) => {
    try {
      const { filingId } = req.params;
      const filing = await getBreederFilingProjection(pool, filingId);
      if (!filing) {
        throw new ApiError(404, 'BREEDER_FILING_NOT_FOUND', 'Breeder filing not found');
      }
      res.json(filing);
    } catch (error) {
      next(error);
    }
  });

  router.post('/marketplace/webhooks/register', marketplaceLimiter, async (req, res, next) => {
    try {
      const partner = await readMarketplacePartnerAuth(pool, req);
      if (!partner.scopes.includes('MARKETPLACE_WEBHOOKS')) {
        throw new ApiError(403, 'MISSING_MARKETPLACE_WEBHOOK_SCOPE', 'Marketplace API key missing MARKETPLACE_WEBHOOKS scope');
      }

      applyMarketplaceRateLimit(partner.partnerId, partner.rateLimitPerMinute);
      const callbackUrl = typeof req.body?.callbackUrl === 'string' ? req.body.callbackUrl.trim() : '';
      if (!/^https?:\/\//i.test(callbackUrl)) {
        throw new ApiError(400, 'INVALID_CALLBACK_URL', 'callbackUrl must be an absolute URL');
      }

      const eventTypes = Array.isArray(req.body?.eventTypes)
        ? req.body.eventTypes
          .filter((item: unknown): item is string => typeof item === 'string')
          .map((item: string) => item.toUpperCase())
        : ['MARKETPLACE_LICENSE_STATUS_DRIFT_DETECTED'];
      const filteredEventTypes = eventTypes.length > 0
        ? eventTypes
        : ['MARKETPLACE_LICENSE_STATUS_DRIFT_DETECTED'];
      const correlationId = typeof req.body?.correlationId === 'string' && isUuid(req.body.correlationId)
        ? req.body.correlationId
        : crypto.randomUUID();
      const subscriptionId = crypto.randomUUID();
      const webhookSecret = crypto.randomUUID().replace(/-/g, '');

      await pool.query(
        `INSERT INTO marketplace_partner_webhooks (
           subscription_id,
           partner_id,
           callback_url,
           webhook_secret,
           event_types,
           status,
           created_at,
           updated_at
         ) VALUES ($1::uuid, $2, $3, $4, $5::jsonb, 'ACTIVE', clock_timestamp(), clock_timestamp())`,
        [subscriptionId, partner.partnerId, callbackUrl, webhookSecret, JSON.stringify(filteredEventTypes)],
      );

      await appendPublicEvent(
        store,
        'MARKETPLACE_WEBHOOK_SUBSCRIBED',
        'MARKETPLACE_PARTNER',
        deriveMarketplaceAggregateId(partner.partnerId, 'WEBHOOKS'),
        {
          subscriptionId,
          partnerId: partner.partnerId,
          callbackUrl,
          eventTypes: filteredEventTypes,
          actorKeyId: partner.keyId,
        },
        correlationId,
      );

      res.status(201).json({
        subscriptionId,
        partnerId: partner.partnerId,
        callbackUrl,
        eventTypes: filteredEventTypes,
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/marketplace/verify-listing', marketplaceLimiter, async (req, res, next) => {
    try {
      const partner = await readMarketplacePartnerAuth(pool, req);
      applyMarketplaceRateLimit(partner.partnerId, partner.rateLimitPerMinute);

      const listingId = typeof req.body?.listingId === 'string' ? req.body.listingId.trim() : '';
      if (!listingId) {
        throw new ApiError(400, 'MISSING_LISTING_ID', 'listingId is required');
      }

      const occurredAt = parseOccurredAtOrNow(req.body?.occurredAt);
      const correlationId = typeof req.body?.correlationId === 'string' && isUuid(req.body.correlationId)
        ? req.body.correlationId
        : crypto.randomUUID();
      const requestPayload: MarketplaceVerificationInput = {
        listingId,
        occurredAt: occurredAt.toISOString(),
        licenseId: typeof req.body?.licenseId === 'string' ? req.body.licenseId.trim() : undefined,
        licenseNumber: typeof req.body?.licenseNumber === 'string' ? req.body.licenseNumber.trim() : undefined,
      };
      const idempotencyPayload = {
        partnerId: partner.partnerId,
        listingId,
        occurredAt: typeof req.body?.occurredAt === 'string' ? req.body.occurredAt : null,
        licenseId: typeof req.body?.licenseId === 'string' ? req.body.licenseId.trim() : null,
        licenseNumber: typeof req.body?.licenseNumber === 'string' ? req.body.licenseNumber.trim() : null,
      };
      const idempotencyKey = typeof req.headers['idempotency-key'] === 'string'
        ? req.headers['idempotency-key']
        : null;

      const { response, replayed } = await withIdempotency(
        pool,
        idempotency,
        'MARKETPLACE_VERIFY_LISTING',
        idempotencyKey,
        idempotencyPayload,
        async () => {
          const prior = await getLatestMarketplaceListingDecision(pool, partner.partnerId, listingId);
          const resolved = await resolveMarketplaceVerification(pool, requestPayload);
          const policy = decisionForStatus(resolved.status);
          const reasonCodes = resolved.reasonCodeOverride ? [resolved.reasonCodeOverride] : policy.reasonCodes;
          const decision = resolved.reasonCodeOverride ? 'BLOCK' : policy.decision;
          const assertion = buildMarketplaceAssertion({
            partnerId: partner.partnerId,
            listingId,
            licenseId: resolved.licenseId,
            licenseNumber: resolved.licenseNumber,
            status: resolved.status,
            decision,
            reasonCodes,
            occurredAt,
          });

          const aggregateId = deriveMarketplaceAggregateId(partner.partnerId, listingId);
          const verificationEventId = await appendPublicEvent(
            store,
            'MARKETPLACE_LISTING_VERIFIED',
            'MARKETPLACE_LISTING',
            aggregateId,
            {
              partnerId: partner.partnerId,
              listingId,
              licenseId: resolved.licenseId,
              licenseNumber: resolved.licenseNumber,
              status: resolved.status,
              decision,
              reasonCodes,
              assertionId: assertion.assertionId,
              assertionExpiresAt: assertion.expiresAt,
              partnerKeyId: partner.keyId,
            },
            correlationId,
            null,
            occurredAt,
          );

          if (resolved.licenseId) {
            await appendPublicEvent(
              store,
              'LICENSE_VERIFICATION_PERFORMED',
              'LICENSE',
              resolved.licenseId,
              {
                licenseId: resolved.licenseId,
                verifierType: 'MARKETPLACE_PARTNER',
                partnerId: partner.partnerId,
                listingId,
                result: resolved.status,
                decision,
              },
              correlationId,
              verificationEventId,
              occurredAt,
            );
          }

          if (prior && prior.status !== resolved.status) {
            const driftEventId = await appendPublicEvent(
              store,
              'MARKETPLACE_LICENSE_STATUS_DRIFT_DETECTED',
              'MARKETPLACE_LISTING',
              aggregateId,
              {
                partnerId: partner.partnerId,
                listingId,
                previousStatus: prior.status,
                previousDecision: prior.decision,
                nextStatus: resolved.status,
                nextDecision: decision,
              },
              correlationId,
              verificationEventId,
              occurredAt,
            );

            const subscriptions = await getActiveMarketplaceWebhookSubscriptions(pool, partner.partnerId);
            if (subscriptions.length > 0) {
              await dispatchMarketplaceStatusDriftWebhooks(
                pool,
                store,
                correlationId,
                driftEventId,
                subscriptions,
                {
                  eventType: 'MARKETPLACE_LICENSE_STATUS_DRIFT_DETECTED',
                  driftEventId,
                  partnerId: partner.partnerId,
                  listingId,
                  previousStatus: prior.status,
                  previousDecision: prior.decision,
                  nextStatus: resolved.status,
                  nextDecision: decision,
                  occurredAt: occurredAt.toISOString(),
                },
              );
            }
          }

          const outcome: MarketplaceVerificationOutcome = {
            listingId,
            licenseId: resolved.licenseId,
            licenseNumber: resolved.licenseNumber,
            status: resolved.status,
            decision,
            reasonCodes,
            assertion,
          };

          return {
            partnerId: partner.partnerId,
            correlationId,
            outcome,
          };
        },
      );

      res.json({
        ...response,
        replayed,
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/marketplace/verify-batch', marketplaceLimiter, async (req, res, next) => {
    try {
      const partner = await readMarketplacePartnerAuth(pool, req);
      applyMarketplaceRateLimit(partner.partnerId, partner.rateLimitPerMinute);
      const checks = Array.isArray(req.body?.checks)
        ? req.body.checks.filter((item: unknown): item is MarketplaceVerificationInput => Boolean(item) && typeof item === 'object')
        : [];
      if (checks.length === 0 || checks.length > 100) {
        throw new ApiError(400, 'INVALID_BATCH_SIZE', 'checks must contain between 1 and 100 entries');
      }

      const correlationId = typeof req.body?.correlationId === 'string' && isUuid(req.body.correlationId)
        ? req.body.correlationId
        : crypto.randomUUID();
      const idempotencyKey = typeof req.headers['idempotency-key'] === 'string'
        ? req.headers['idempotency-key']
        : null;

      const { response, replayed } = await withIdempotency(
        pool,
        idempotency,
        'MARKETPLACE_VERIFY_BATCH',
        idempotencyKey,
        {
          partnerId: partner.partnerId,
          checks,
        },
        async () => {
          const outcomes: MarketplaceVerificationOutcome[] = [];
          const perCheckOccurred = new Map<string, Date>();

          for (const check of checks) {
            const listingId = typeof check.listingId === 'string' ? check.listingId.trim() : '';
            if (!listingId) {
              throw new ApiError(400, 'MISSING_LISTING_ID', 'each check requires listingId');
            }

            const occurredAt = parseOccurredAtOrNow(check.occurredAt);
            const resolved = await resolveMarketplaceVerification(pool, check);
            const policy = decisionForStatus(resolved.status);
            const reasonCodes = resolved.reasonCodeOverride ? [resolved.reasonCodeOverride] : policy.reasonCodes;
            const decision = resolved.reasonCodeOverride ? 'BLOCK' : policy.decision;
            const assertion = buildMarketplaceAssertion({
              partnerId: partner.partnerId,
              listingId,
              licenseId: resolved.licenseId,
              licenseNumber: resolved.licenseNumber,
              status: resolved.status,
              decision,
              reasonCodes,
              occurredAt,
            });
            perCheckOccurred.set(listingId, occurredAt);

            outcomes.push({
              listingId,
              licenseId: resolved.licenseId,
              licenseNumber: resolved.licenseNumber,
              status: resolved.status,
              decision,
              reasonCodes,
              assertion,
            });
          }

          const batchAggregateId = deriveMarketplaceAggregateId(partner.partnerId, correlationId);
          const batchEventId = await appendPublicEvent(
            store,
            'MARKETPLACE_BATCH_VERIFICATION_PERFORMED',
            'MARKETPLACE',
            batchAggregateId,
            {
              partnerId: partner.partnerId,
              checkCount: checks.length,
              outcomeSummary: {
                allow: outcomes.filter((item) => item.decision === 'ALLOW').length,
                block: outcomes.filter((item) => item.decision === 'BLOCK').length,
                review: outcomes.filter((item) => item.decision === 'REVIEW').length,
              },
            },
            correlationId,
          );

          await Promise.all(outcomes.map((item) => appendPublicEvent(
            store,
            'MARKETPLACE_LISTING_VERIFIED',
            'MARKETPLACE_LISTING',
            deriveMarketplaceAggregateId(partner.partnerId, item.listingId),
            {
              partnerId: partner.partnerId,
              listingId: item.listingId,
              licenseId: item.licenseId,
              licenseNumber: item.licenseNumber,
              status: item.status,
              decision: item.decision,
              reasonCodes: item.reasonCodes,
              assertionId: item.assertion.assertionId,
              assertionExpiresAt: item.assertion.expiresAt,
              partnerKeyId: partner.keyId,
            },
            correlationId,
            batchEventId,
            perCheckOccurred.get(item.listingId) ?? new Date(),
          )));

          return {
            partnerId: partner.partnerId,
            correlationId,
            outcomes,
          };
        },
      );

      res.json({
        ...response,
        replayed,
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

  // Read-only breeder compliance queue (regulator/admin feed)
  router.get('/compliance/breeder-queue', registryLimiter, async (req, res, next) => {
    try {
      const adminKey = process.env.BARK_COMPLIANCE_READ_KEY;
      if (!adminKey || req.headers['x-wvda-admin-key'] !== adminKey) {
        throw new ApiError(403, 'FORBIDDEN', 'WVDA admin key required for compliance queue feed');
      }

      const requestedStatus = typeof req.query.status === 'string' ? req.query.status.toUpperCase() : null;
      const statusFilter =
        requestedStatus === 'ON_TIME' ||
        requestedStatus === 'DUE_SOON' ||
        requestedStatus === 'OVERDUE' ||
        requestedStatus === 'CURED'
          ? requestedStatus
          : null;
      const limit = Math.min(Math.max(Number(req.query.limit ?? 100) || 100, 1), 500);

      const result = await pool.query(
        `SELECT filing_id::text,
                license_id::text,
                filing_type,
                status,
                due_at,
                cure_deadline_at,
                submitted_at,
                amended_at,
                cured_at,
                last_event_id::text,
                last_event_ingested_at,
                reporting_year,
                reporting_quarter
           FROM breeder_compliance_queue_projection
          WHERE ($1::text IS NULL OR status = $1::text)
          ORDER BY
            CASE status
              WHEN 'OVERDUE' THEN 0
              WHEN 'DUE_SOON' THEN 1
              WHEN 'ON_TIME' THEN 2
              WHEN 'CURED' THEN 3
              ELSE 4
            END,
            due_at ASC,
            filing_id ASC
          LIMIT $2`,
        [statusFilter, limit]
      );

      const items: BreederComplianceFeedItem[] = result.rows.map((row) => ({
        filingId: row.filing_id,
        licenseId: row.license_id,
        filingType: row.filing_type,
        status: row.status,
        dueAt: row.due_at?.toISOString?.() ?? String(row.due_at),
        cureDeadlineAt: row.cure_deadline_at?.toISOString?.() ?? (row.cure_deadline_at ? String(row.cure_deadline_at) : null),
        submittedAt: row.submitted_at?.toISOString?.() ?? (row.submitted_at ? String(row.submitted_at) : null),
        amendedAt: row.amended_at?.toISOString?.() ?? (row.amended_at ? String(row.amended_at) : null),
        curedAt: row.cured_at?.toISOString?.() ?? (row.cured_at ? String(row.cured_at) : null),
        lastEventId: row.last_event_id,
        lastEventIngestedAt: row.last_event_ingested_at?.toISOString?.() ?? String(row.last_event_ingested_at),
        reportingYear: row.reporting_year ?? null,
        reportingQuarter: row.reporting_quarter ?? null,
      }));

      res.json({
        items,
        count: items.length,
        status: statusFilter,
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
