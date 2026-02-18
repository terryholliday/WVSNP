import { Pool, PoolClient } from 'pg';
import { EventStore, Watermark, DomainEvent } from '../event-store';
import {
  BreederFilingType,
  calculateComplianceStatus,
  calculateCureDeadlineAt,
  calculateDueAt,
} from '../domain/compliance/timeline-logic';

const ALLOWED_EVENTS = new Set([
  // Application events (Phase 1)
  'APPLICATION_STARTED',
  'APPLICATION_FIELD_RECORDED',
  'APPLICATION_FIELD_CLEARED',
  'APPLICATION_SECTION_COMPLETED',
  'APPLICATION_LIRP_MODE_SET',
  'APPLICATION_PRIORITY_FACTORS_COMPUTED',
  'ATTACHMENT_ADDED',
  'APPLICATION_EVIDENCE_ATTACHED', // legacy compat
  'ATTACHMENT_REMOVED',
  'ATTESTATION_RECORDED',
  'APPLICATION_SUBMITTED',
  'APPLICATION_TOKEN_CONSUMED',
  'APPLICATION_SCORED',
  'APPLICATION_AWARDED',
  'APPLICATION_WAITLISTED',
  'APPLICATION_DENIED',
  'APPLICATION_APPROVED', // legacy alias
  'APPLICATION_EXPORT_GENERATED',
  'SUBMISSION_DEADLINE_ENFORCED',
  'APPLICATION_EVENT_REJECTED',
  'SUBMISSION_TOKEN_ISSUED',
  'SUBMISSION_TOKEN_CONSUMED',
  'APPLICATION_SUBMISSION_REJECTED',
  'FRAUD_SIGNAL_DETECTED', // advisory (ratified per ambiguity report 2026-02-07)
  // Grant events (Phase 2)
  'GRANT_CREATED',
  'GRANT_AGREEMENT_SIGNED',
  'GRANT_ACTIVATED',
  'GRANT_FUNDS_ENCUMBERED',
  'GRANT_FUNDS_RELEASED',
  'GRANT_FUNDS_LIQUIDATED',
  'GRANT_SUSPENDED',
  'GRANT_REINSTATED',
  'GRANT_CLOSED',
  'LIRP_MUST_HONOR_ENFORCED',
  'MATCHING_FUNDS_REPORTED',
  'MATCHING_FUNDS_ADJUSTED',
  // Voucher events (Phase 2)
  'VOUCHER_ISSUED',
  'VOUCHER_ISSUED_TENTATIVE',
  'VOUCHER_ISSUED_CONFIRMED',
  'VOUCHER_ISSUED_REJECTED',
  'VOUCHER_REDEEMED',
  'VOUCHER_EXPIRED',
  'VOUCHER_VOIDED',
  'VOUCHER_AMENDED',
  // Allocator events (Phase 2)
  'VOUCHER_CODE_ALLOCATOR_INITIALIZED',
  'VOUCHER_CODE_ALLOCATED',
  // Vet Clinic events (Phase 3)
  'VET_CLINIC_REGISTERED',
  'VET_CLINIC_LICENSE_STATUS_RECORDED',
  'VET_CLINIC_SUSPENDED',
  'VET_CLINIC_REINSTATED',
  'VET_CLINIC_PAYMENT_INFO_UPDATED',
  'VET_CLINIC_OASIS_VENDOR_CODE_ASSIGNED',
  // Claim events (Phase 3)
  'CLAIM_SUBMITTED',
  'CLAIM_APPROVED',
  'CLAIM_DENIED',
  'CLAIM_ADJUSTED',
  'CLAIM_INVOICED',
  'CLAIM_DECISION_CONFLICT_RECORDED',
  // Invoice events (Phase 3)
  'INVOICE_GENERATED',
  'INVOICE_SUBMITTED',
  'INVOICE_ADJUSTMENT_CREATED',
  'INVOICE_ADJUSTMENT_APPLIED',
  // Payment events (Phase 3)
  'PAYMENT_RECORDED',
  'PAYMENT_SHORTFALL_FLAGGED',
  'PAYMENT_SHORTFALL_RESOLVED',
  // OASIS events (Phase 4)
  'OASIS_BATCH_GENERATED',
  'OASIS_EXPORT_BATCH_CREATED',
  'OASIS_EXPORT_BATCH_ITEM_ADDED',
  'OASIS_EXPORT_FILE_RENDERED',
  'OASIS_EXPORT_BATCH_SUBMITTED',
  'OASIS_EXPORT_BATCH_ACKNOWLEDGED',
  'OASIS_EXPORT_BATCH_REJECTED',
  'OASIS_EXPORT_BATCH_VOIDED',
  'OASIS_BATCH_SUBMITTED',    // alias
  'OASIS_BATCH_ACKNOWLEDGED', // alias
  'OASIS_BATCH_REJECTED',     // alias
  // Closeout events (Phase 4)
  'GRANT_PERIOD_ENDED',
  'GRANT_CLAIMS_DEADLINE_PASSED',
  'GRANT_FINAL_REPORT_GENERATED',
  'GRANT_FINAL_REPORT_SUBMITTED',
  'GRANT_CLOSEOUT_APPROVED',
  'GRANT_CYCLE_CLOSEOUT_PREFLIGHT_COMPLETED',
  'GRANT_CYCLE_CLOSEOUT_STARTED',
  'GRANT_CYCLE_CLOSEOUT_RECONCILED',
  'GRANT_CYCLE_CLOSED',
  'GRANT_CYCLE_CLOSEOUT_AUDIT_HOLD',
  'GRANT_CYCLE_CLOSEOUT_AUDIT_RESOLVED',
  'GRANT_CYCLE_CLOSEOUT_ARTIFACT_ATTACHED',
  'GRANT_CLOSEOUT_AUDIT_HOLD',   // alias
  'GRANT_CLOSEOUT_AUDIT_RESOLVED', // alias
  // Breeder compliance reporting events (Agent 4)
  'BREEDER_TRANSFER_CONFIRMATION_FILED',
  'BREEDER_TRANSFER_CONFIRMATION_AMENDED',
  'BREEDER_ACCIDENTAL_LITTER_REGISTRATION_FILED',
  'BREEDER_ACCIDENTAL_LITTER_REGISTRATION_AMENDED',
  'BREEDER_QUARTERLY_TRANSITION_REPORT_FILED',
  'BREEDER_QUARTERLY_TRANSITION_REPORT_AMENDED',
  'BREEDER_FILING_CURED',
]);

// ============================================
// IN-MEMORY STATE TYPES FOR REBUILD
// ============================================

interface ProjectionWatermark {
  rebuiltAt: Date;
  watermarkIngestedAt: Date;
  watermarkEventId: string;
}

interface ApplicationState {
  applicationId: string;
  granteeId: string;
  grantCycleId: string;
  organizationName: string | null;
  organizationType: string | null;
  requestedAmountCents: bigint | null;
  matchCommitmentCents: bigint | null;
  matchLevel: string | null;
  status: string | null;
  completenessPercent: number | null;
  priorityScore: number | null;
}

interface BucketState {
  grantId: string;
  grantCycleId: string;
  bucketType: 'GENERAL' | 'LIRP';
  awardedCents: bigint;
  availableCents: bigint;
  encumberedCents: bigint;
  liquidatedCents: bigint;
  releasedCents: bigint;
  rateNumeratorCents: bigint;
  rateDenominatorCents: bigint;
  matchingCommittedCents: bigint;
  matchingReportedCents: bigint;
}

interface VoucherState {
  voucherId: string;
  grantId: string;
  voucherCode: string | null;
  countyCode: string | null;
  status: string;
  maxReimbursementCents: bigint;
  isLirp: boolean;
  tentativeExpiresAt: Date | null;
  expiresAt: Date | null;
  issuedAt: Date | null;
  redeemedAt: Date | null;
  expiredAt: Date | null;
  voidedAt: Date | null;
}

interface AllocatorState {
  allocatorId: string;
  grantCycleId: string;
  countyCode: string;
  nextSequence: number;
}

interface ClinicState {
  clinicId: string;
  clinicName: string;
  status: string;
  licenseStatus: string;
  licenseNumber: string | null;
  licenseExpiresAt: Date | null;
  oasisVendorCode: string | null;
  paymentInfo: any | null;
  registeredAt: Date | null;
  suspendedAt: Date | null;
  reinstatedAt: Date | null;
}

interface ClaimState {
  claimId: string;
  claimFingerprint: string;
  grantCycleId: string;
  voucherId: string;
  clinicId: string;
  procedureCode: string;
  dateOfService: string;
  status: string;
  submittedAmountCents: bigint;
  approvedAmountCents: bigint | null;
  decisionBasis: any | null;
  invoiceId: string | null;
  submittedAt: Date | null;
  approvedAt: Date | null;
  approvedEventId: string | null;
  deniedAt: Date | null;
  adjustedAt: Date | null;
  invoicedAt: Date | null;
}

interface InvoiceState {
  invoiceId: string;
  clinicId: string;
  grantCycleId: string;
  periodStart: string;
  periodEnd: string;
  totalAmountCents: bigint;
  claimIds: string[];
  adjustmentIds: string[];
  status: string;
  submittedAt: Date | null;
  generatedAt: Date | null;
  oasisExportBatchId: string | null;
}

interface PaymentState {
  paymentId: string;
  invoiceId: string;
  amountCents: bigint;
  paymentChannel: string;
  referenceId: string | null;
  recordedAt: Date | null;
}

interface AdjustmentState {
  adjustmentId: string;
  sourceInvoiceId: string;
  grantCycleId: string;
  clinicId: string | null;
  targetInvoiceId: string | null;
  amountCents: bigint;
  reason: string | null;
  recordedAt: Date | null;
  appliedAt: Date | null;
}

interface OasisBatchState {
  exportBatchId: string;
  grantCycleId: string;
  batchCode: string;
  batchFingerprint: string;
  periodStart: string;
  periodEnd: string;
  wmIngestedAt: Date;
  wmEventId: string;
  status: string;
  recordCount: number;
  controlTotalCents: bigint;
  artifactId: string | null;
  fileSha256: string | null;
  formatVersion: string | null;
  submittedAt: Date | null;
  submissionMethod: string | null;
  oasisRefId: string | null;
  acknowledgedAt: Date | null;
  rejectionReason: string | null;
  rejectionCode: string | null;
  voidedReason: string | null;
  voidedByActorId: string | null;
  items: Array<{ invoiceId: string; clinicId: string; oasisVendorCode: string; amountCents: bigint; periodStart: string; periodEnd: string }>;
}

interface CloseoutState {
  grantCycleId: string;
  closeoutStatus: string;
  preflightStatus: string | null;
  preflightChecks: any | null;
  startedAt: Date | null;
  reconciledAt: Date | null;
  financialSummary: any | null;
  matchingFunds: any | null;
  activitySummary: any | null;
  reconciliationWmIngestedAt: Date | null;
  reconciliationWmEventId: string | null;
  closedAt: Date | null;
  closedByActorId: string | null;
  finalBalanceCents: bigint | null;
  auditHoldReason: string | null;
  auditHoldAt: Date | null;
  auditResolvedAt: Date | null;
  auditResolution: string | null;
}

interface BreederComplianceState {
  filingId: string;
  licenseId: string | null;
  grantCycleId: string;
  filingType: BreederFilingType;
  reportingYear: number | null;
  reportingQuarter: number | null;
  occurredAt: Date | null;
  dueAt: Date;
  cureDeadlineAt: Date | null;
  submittedAt: Date | null;
  amendedAt: Date | null;
  curedAt: Date | null;
  status: 'ON_TIME' | 'DUE_SOON' | 'OVERDUE' | 'CURED';
  lastEventId: string;
  lastEventIngestedAt: Date;
}

// ============================================
// ALL PROJECTION STATE MAPS
// ============================================
interface RebuildState {
  applications: Map<string, ApplicationState>;
  grantBuckets: Map<string, BucketState>;       // key: grantId:bucketType
  vouchers: Map<string, VoucherState>;
  allocators: Map<string, AllocatorState>;
  clinics: Map<string, ClinicState>;
  claims: Map<string, ClaimState>;
  invoices: Map<string, InvoiceState>;
  payments: Map<string, PaymentState>;
  adjustments: Map<string, AdjustmentState>;
  oasisBatches: Map<string, OasisBatchState>;
  closeouts: Map<string, CloseoutState>;
  breederComplianceQueue: Map<string, BreederComplianceState>;
}

function createEmptyState(): RebuildState {
  return {
    applications: new Map(),
    grantBuckets: new Map(),
    vouchers: new Map(),
    allocators: new Map(),
    clinics: new Map(),
    claims: new Map(),
    invoices: new Map(),
    payments: new Map(),
    adjustments: new Map(),
    oasisBatches: new Map(),
    closeouts: new Map(),
    breederComplianceQueue: new Map(),
  };
}

// ============================================
// HELPERS
// ============================================

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`MISSING_REQUIRED_FIELD:${field}`);
  }
  return value;
}

function ensureAllowedEvent(event: DomainEvent): void {
  if (!ALLOWED_EVENTS.has(event.eventType)) {
    // Skip unknown events rather than crash — allows forward compat
    return;
  }
}

function toBigInt(v: unknown): bigint {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'string') return BigInt(v);
  if (typeof v === 'number') return BigInt(v);
  return 0n;
}

function asDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const next = new Date(value);
    return Number.isNaN(next.getTime()) ? null : next;
  }
  return null;
}

function asNullableInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value)) {
    return value;
  }
  if (typeof value === 'string' && /^-?\d+$/.test(value)) {
    return parseInt(value, 10);
  }
  return null;
}

function filingTypeFromEvent(eventType: string): BreederFilingType | null {
  if (eventType.startsWith('BREEDER_TRANSFER_CONFIRMATION_')) {
    return 'TRANSFER_CONFIRMATION';
  }
  if (eventType.startsWith('BREEDER_ACCIDENTAL_LITTER_REGISTRATION_')) {
    return 'ACCIDENTAL_LITTER_REGISTRATION';
  }
  if (eventType.startsWith('BREEDER_QUARTERLY_TRANSITION_REPORT_')) {
    return 'QUARTERLY_TRANSITION_REPORT';
  }
  return null;
}

// ============================================
// EVENT DISPATCH — routes each event to the correct projection(s)
// ============================================

function dispatchEvent(state: RebuildState, event: DomainEvent): void {
  const d = event.eventData as Record<string, unknown>;
  const t = event.eventType;

  // --- APPLICATION EVENTS ---
  if (t === 'APPLICATION_STARTED') {
    const id = event.aggregateId;
    state.applications.set(id, {
      applicationId: id,
      granteeId: d.granteeId as string || '',
      grantCycleId: event.grantCycleId,
      organizationName: d.organizationName as string || null,
      organizationType: d.organizationType as string || null,
      requestedAmountCents: null,
      matchCommitmentCents: null,
      matchLevel: null,
      status: 'DRAFT',
      completenessPercent: 0,
      priorityScore: null,
    });
    return;
  }
  if (t === 'APPLICATION_SUBMITTED') {
    const app = state.applications.get(event.aggregateId);
    if (app) {
      app.status = 'SUBMITTED';
      app.completenessPercent = 100;
      app.requestedAmountCents = toBigInt(d.requestedAmountCents);
      app.matchCommitmentCents = toBigInt(d.matchCommitmentCents);
    }
    return;
  }
  if (t === 'APPLICATION_SCORED') {
    const app = state.applications.get(event.aggregateId);
    if (app) {
      app.status = 'SCORED';
      app.priorityScore = d.priorityScore as number;
    }
    return;
  }
  if (t === 'APPLICATION_AWARDED' || t === 'APPLICATION_APPROVED') {
    const app = state.applications.get(event.aggregateId);
    if (app) { app.status = 'AWARDED'; }
    return;
  }
  if (t === 'APPLICATION_DENIED') {
    const app = state.applications.get(event.aggregateId);
    if (app) { app.status = 'DENIED'; }
    return;
  }
  if (t === 'APPLICATION_WAITLISTED') {
    const app = state.applications.get(event.aggregateId);
    if (app) { app.status = 'WAITLISTED'; }
    return;
  }
  if (t === 'APPLICATION_SECTION_COMPLETED') {
    const app = state.applications.get(event.aggregateId);
    if (app && app.completenessPercent !== null && app.completenessPercent < 100) {
      // Increment completeness (6 sections = ~17% each)
      app.completenessPercent = Math.min(100, (app.completenessPercent || 0) + 17);
    }
    return;
  }

  // --- GRANT EVENTS ---
  if (t === 'GRANT_CREATED') {
    const grantId = event.aggregateId;
    const awarded = toBigInt(d.awardedAmountCents);
    const matchCommit = toBigInt(d.matchCommitmentCents);
    const rateNum = toBigInt(d.rateNumeratorCents);
    const rateDen = toBigInt(d.rateDenominatorCents);
    const lirpEnabled = d.lirpEnabled as boolean;
    const lirpAlloc = lirpEnabled ? toBigInt(d.lirpAllocationCents) : 0n;

    state.grantBuckets.set(`${grantId}:GENERAL`, {
      grantId, grantCycleId: event.grantCycleId, bucketType: 'GENERAL',
      awardedCents: awarded,
      availableCents: lirpEnabled ? awarded - lirpAlloc : awarded,
      encumberedCents: 0n, liquidatedCents: 0n, releasedCents: 0n,
      rateNumeratorCents: rateNum, rateDenominatorCents: rateDen,
      matchingCommittedCents: matchCommit, matchingReportedCents: 0n,
    });
    if (lirpEnabled) {
      state.grantBuckets.set(`${grantId}:LIRP`, {
        grantId, grantCycleId: event.grantCycleId, bucketType: 'LIRP',
        awardedCents: lirpAlloc, availableCents: lirpAlloc,
        encumberedCents: 0n, liquidatedCents: 0n, releasedCents: 0n,
        rateNumeratorCents: rateNum, rateDenominatorCents: rateDen,
        matchingCommittedCents: 0n, matchingReportedCents: 0n,
      });
    }
    return;
  }
  if (t === 'GRANT_FUNDS_ENCUMBERED') {
    const bucket = d.isLIRP ? 'LIRP' : 'GENERAL';
    const b = state.grantBuckets.get(`${event.aggregateId}:${bucket}`);
    if (b) {
      const amt = toBigInt(d.amountCents);
      b.availableCents -= amt;
      b.encumberedCents += amt;
    }
    return;
  }
  if (t === 'GRANT_FUNDS_RELEASED') {
    const bucket = d.isLIRP ? 'LIRP' : 'GENERAL';
    const b = state.grantBuckets.get(`${event.aggregateId}:${bucket}`);
    if (b) {
      const amt = toBigInt(d.amountCents);
      b.encumberedCents -= amt;
      b.availableCents += amt;
      b.releasedCents += amt;
    }
    return;
  }
  if (t === 'GRANT_FUNDS_LIQUIDATED') {
    const bucket = d.isLIRP ? 'LIRP' : 'GENERAL';
    const b = state.grantBuckets.get(`${event.aggregateId}:${bucket}`);
    if (b) {
      const amt = toBigInt(d.amountCents);
      b.encumberedCents -= amt;
      b.liquidatedCents += amt;
    }
    return;
  }
  if (t === 'MATCHING_FUNDS_REPORTED' || t === 'MATCHING_FUNDS_ADJUSTED') {
    const b = state.grantBuckets.get(`${event.aggregateId}:GENERAL`);
    if (b) { b.matchingReportedCents += toBigInt(d.amountCents); }
    return;
  }

  // --- VOUCHER EVENTS ---
  if (t === 'VOUCHER_ISSUED_TENTATIVE') {
    state.vouchers.set(event.aggregateId, {
      voucherId: event.aggregateId,
      grantId: d.grantId as string || '',
      voucherCode: null,
      countyCode: d.countyCode as string || null,
      status: 'TENTATIVE',
      maxReimbursementCents: toBigInt(d.maxReimbursementCents),
      isLirp: d.isLIRP as boolean || false,
      tentativeExpiresAt: d.tentativeExpiresAt ? new Date(d.tentativeExpiresAt as string) : null,
      expiresAt: d.tentativeExpiresAt ? new Date(d.tentativeExpiresAt as string) : new Date(),
      issuedAt: null, redeemedAt: null, expiredAt: null, voidedAt: null,
    });
    return;
  }
  if (t === 'VOUCHER_ISSUED') {
    const existing = state.vouchers.get(event.aggregateId);
    if (existing) {
      existing.voucherCode = d.voucherCode as string;
      existing.status = 'ISSUED';
      existing.maxReimbursementCents = toBigInt(d.maxReimbursementCents);
      existing.isLirp = d.isLIRP as boolean || false;
      existing.expiresAt = new Date(d.expiresAt as string);
      existing.issuedAt = event.ingestedAt;
      existing.tentativeExpiresAt = null;
    } else {
      state.vouchers.set(event.aggregateId, {
        voucherId: event.aggregateId,
        grantId: d.grantId as string || '',
        voucherCode: d.voucherCode as string,
        countyCode: d.countyCode as string || null,
        status: 'ISSUED',
        maxReimbursementCents: toBigInt(d.maxReimbursementCents),
        isLirp: d.isLIRP as boolean || false,
        tentativeExpiresAt: null,
        expiresAt: new Date(d.expiresAt as string),
        issuedAt: event.ingestedAt,
        redeemedAt: null, expiredAt: null, voidedAt: null,
      });
    }
    return;
  }
  if (t === 'VOUCHER_ISSUED_CONFIRMED') {
    const v = state.vouchers.get(event.aggregateId);
    if (v) {
      v.voucherCode = d.voucherCode as string;
      v.status = 'ISSUED';
      v.issuedAt = new Date(d.confirmedAt as string);
      if (d.expiresAt) v.expiresAt = new Date(d.expiresAt as string);
      v.tentativeExpiresAt = null;
    }
    return;
  }
  if (t === 'VOUCHER_ISSUED_REJECTED') {
    const v = state.vouchers.get(event.aggregateId);
    if (v) { v.status = 'VOIDED'; v.voidedAt = event.ingestedAt; }
    return;
  }
  if (t === 'VOUCHER_REDEEMED') {
    const v = state.vouchers.get(event.aggregateId);
    if (v) { v.status = 'REDEEMED'; v.redeemedAt = event.ingestedAt; }
    return;
  }
  if (t === 'VOUCHER_EXPIRED') {
    const v = state.vouchers.get(event.aggregateId);
    if (v) { v.status = 'EXPIRED'; v.expiredAt = event.ingestedAt; }
    return;
  }
  if (t === 'VOUCHER_VOIDED') {
    const v = state.vouchers.get(event.aggregateId);
    if (v) { v.status = 'VOIDED'; v.voidedAt = event.ingestedAt; }
    return;
  }

  // --- ALLOCATOR EVENTS ---
  if (t === 'VOUCHER_CODE_ALLOCATOR_INITIALIZED') {
    state.allocators.set(event.aggregateId, {
      allocatorId: event.aggregateId,
      grantCycleId: event.grantCycleId,
      countyCode: d.countyCode as string || '',
      nextSequence: 1,
    });
    return;
  }
  if (t === 'VOUCHER_CODE_ALLOCATED') {
    const a = state.allocators.get(event.aggregateId);
    if (a) { a.nextSequence += 1; }
    return;
  }

  // --- VET CLINIC EVENTS ---
  if (t === 'VET_CLINIC_REGISTERED') {
    state.clinics.set(event.aggregateId, {
      clinicId: event.aggregateId,
      clinicName: d.clinicName as string || '',
      status: 'ACTIVE',
      licenseStatus: d.licenseStatus as string || 'UNKNOWN',
      licenseNumber: d.licenseNumber as string || null,
      licenseExpiresAt: d.licenseExpiresAt ? new Date(d.licenseExpiresAt as string) : null,
      oasisVendorCode: d.oasisVendorCode as string || null,
      paymentInfo: d.paymentInfo || null,
      registeredAt: event.ingestedAt,
      suspendedAt: null, reinstatedAt: null,
    });
    return;
  }
  if (t === 'VET_CLINIC_LICENSE_STATUS_RECORDED') {
    const c = state.clinics.get(event.aggregateId);
    if (c) {
      c.licenseStatus = d.licenseStatus as string;
      if (d.licenseNumber) c.licenseNumber = d.licenseNumber as string;
      if (d.licenseExpiresAt) c.licenseExpiresAt = new Date(d.licenseExpiresAt as string);
    }
    return;
  }
  if (t === 'VET_CLINIC_SUSPENDED') {
    const c = state.clinics.get(event.aggregateId);
    if (c) { c.status = 'SUSPENDED'; c.suspendedAt = event.ingestedAt; }
    return;
  }
  if (t === 'VET_CLINIC_REINSTATED') {
    const c = state.clinics.get(event.aggregateId);
    if (c) { c.status = 'ACTIVE'; c.reinstatedAt = event.ingestedAt; }
    return;
  }
  if (t === 'VET_CLINIC_PAYMENT_INFO_UPDATED') {
    const c = state.clinics.get(event.aggregateId);
    if (c) { c.paymentInfo = d.paymentInfo; }
    return;
  }
  if (t === 'VET_CLINIC_OASIS_VENDOR_CODE_ASSIGNED') {
    const c = state.clinics.get(event.aggregateId);
    if (c) { c.oasisVendorCode = d.oasisVendorCode as string; }
    return;
  }

  // --- CLAIM EVENTS ---
  if (t === 'CLAIM_SUBMITTED') {
    state.claims.set(event.aggregateId, {
      claimId: event.aggregateId,
      claimFingerprint: d.claimFingerprint as string || '',
      grantCycleId: event.grantCycleId,
      voucherId: d.voucherId as string || '',
      clinicId: d.clinicId as string || '',
      procedureCode: d.procedureCode as string || '',
      dateOfService: d.dateOfService as string || '',
      status: 'SUBMITTED',
      submittedAmountCents: toBigInt(d.submittedAmountCents),
      approvedAmountCents: null, decisionBasis: null, invoiceId: null,
      submittedAt: event.ingestedAt,
      approvedAt: null, approvedEventId: null, deniedAt: null, adjustedAt: null, invoicedAt: null,
    });
    return;
  }
  if (t === 'CLAIM_APPROVED') {
    const cl = state.claims.get(event.aggregateId);
    if (cl) {
      cl.status = 'APPROVED';
      cl.approvedAmountCents = toBigInt(d.approvedAmountCents);
      cl.decisionBasis = d.decisionBasis || null;
      cl.approvedAt = event.ingestedAt;
      cl.approvedEventId = event.eventId;
    }
    return;
  }
  if (t === 'CLAIM_DENIED') {
    const cl = state.claims.get(event.aggregateId);
    if (cl) {
      cl.status = 'DENIED';
      cl.decisionBasis = d.decisionBasis || null;
      cl.deniedAt = event.ingestedAt;
    }
    return;
  }
  if (t === 'CLAIM_ADJUSTED') {
    const cl = state.claims.get(event.aggregateId);
    if (cl) {
      cl.status = 'ADJUSTED';
      cl.approvedAmountCents = toBigInt(d.newAmountCents);
      cl.adjustedAt = event.ingestedAt;
    }
    return;
  }
  if (t === 'CLAIM_INVOICED') {
    const cl = state.claims.get(event.aggregateId);
    if (cl) {
      cl.status = 'INVOICED';
      cl.invoiceId = d.invoiceId as string;
      cl.invoicedAt = event.ingestedAt;
    }
    return;
  }

  // --- INVOICE EVENTS ---
  if (t === 'INVOICE_GENERATED') {
    state.invoices.set(event.aggregateId, {
      invoiceId: event.aggregateId,
      clinicId: d.clinicId as string || '',
      grantCycleId: event.grantCycleId,
      periodStart: d.periodStart as string || '',
      periodEnd: d.periodEnd as string || '',
      totalAmountCents: toBigInt(d.totalAmountCents),
      claimIds: Array.isArray(d.claimIds) ? d.claimIds as string[] : [],
      adjustmentIds: Array.isArray(d.adjustmentIds) ? d.adjustmentIds as string[] : [],
      status: 'DRAFT',
      submittedAt: null,
      generatedAt: event.ingestedAt,
      oasisExportBatchId: null,
    });
    return;
  }
  if (t === 'INVOICE_SUBMITTED') {
    const inv = state.invoices.get(event.aggregateId);
    if (inv) { inv.status = 'SUBMITTED'; inv.submittedAt = event.ingestedAt; }
    return;
  }

  // --- INVOICE ADJUSTMENT EVENTS ---
  if (t === 'INVOICE_ADJUSTMENT_CREATED') {
    state.adjustments.set(event.aggregateId, {
      adjustmentId: event.aggregateId,
      sourceInvoiceId: d.sourceInvoiceId as string || '',
      grantCycleId: event.grantCycleId,
      clinicId: d.clinicId as string || null,
      targetInvoiceId: null,
      amountCents: toBigInt(d.amountCents),
      reason: d.reason as string || null,
      recordedAt: event.ingestedAt,
      appliedAt: null,
    });
    return;
  }
  if (t === 'INVOICE_ADJUSTMENT_APPLIED') {
    const adj = state.adjustments.get(event.aggregateId);
    if (adj) {
      adj.targetInvoiceId = d.targetInvoiceId as string;
      adj.appliedAt = event.ingestedAt;
    }
    return;
  }

  // --- PAYMENT EVENTS ---
  if (t === 'PAYMENT_RECORDED') {
    state.payments.set(event.aggregateId, {
      paymentId: event.aggregateId,
      invoiceId: d.invoiceId as string || '',
      amountCents: toBigInt(d.amountCents),
      paymentChannel: d.paymentChannel as string || '',
      referenceId: d.referenceId as string || null,
      recordedAt: event.ingestedAt,
    });
    return;
  }

  // --- OASIS BATCH EVENTS ---
  if (t === 'OASIS_EXPORT_BATCH_CREATED') {
    state.oasisBatches.set(event.aggregateId, {
      exportBatchId: event.aggregateId,
      grantCycleId: event.grantCycleId,
      batchCode: d.batchCode as string || '',
      batchFingerprint: d.batchFingerprint as string || '',
      periodStart: d.periodStart as string || '',
      periodEnd: d.periodEnd as string || '',
      wmIngestedAt: d.watermarkIngestedAt ? new Date(d.watermarkIngestedAt as string) : event.ingestedAt,
      wmEventId: d.watermarkEventId as string || event.eventId,
      status: 'CREATED',
      recordCount: 0, controlTotalCents: 0n,
      artifactId: null, fileSha256: null, formatVersion: null,
      submittedAt: null, submissionMethod: null, oasisRefId: null,
      acknowledgedAt: null, rejectionReason: null, rejectionCode: null,
      voidedReason: null, voidedByActorId: null,
      items: [],
    });
    return;
  }
  if (t === 'OASIS_EXPORT_BATCH_ITEM_ADDED') {
    // Find batch by looking at aggregateId or eventData.exportBatchId
    const batchId = d.exportBatchId as string || event.aggregateId;
    const batch = state.oasisBatches.get(batchId);
    if (batch) {
      batch.items.push({
        invoiceId: d.invoiceId as string,
        clinicId: d.clinicId as string,
        oasisVendorCode: d.oasisVendorCode as string,
        amountCents: toBigInt(d.amountCents),
        periodStart: d.invoicePeriodStart as string || batch.periodStart,
        periodEnd: d.invoicePeriodEnd as string || batch.periodEnd,
      });
      batch.recordCount = batch.items.length;
      batch.controlTotalCents += toBigInt(d.amountCents);
    }
    return;
  }
  if (t === 'OASIS_EXPORT_FILE_RENDERED') {
    const batchId = d.exportBatchId as string || event.aggregateId;
    const batch = state.oasisBatches.get(batchId);
    if (batch) {
      batch.status = 'FILE_RENDERED';
      batch.artifactId = d.artifactId as string;
      batch.fileSha256 = d.sha256 as string || null;
      batch.formatVersion = d.formatVersion as string || null;
      if (d.recordCount) batch.recordCount = d.recordCount as number;
      if (d.controlTotalCents) batch.controlTotalCents = toBigInt(d.controlTotalCents);
    }
    return;
  }
  if (t === 'OASIS_EXPORT_BATCH_SUBMITTED' || t === 'OASIS_BATCH_SUBMITTED') {
    const batchId = d.exportBatchId as string || event.aggregateId;
    const batch = state.oasisBatches.get(batchId);
    if (batch) {
      batch.status = 'SUBMITTED';
      batch.submittedAt = event.ingestedAt;
      batch.submissionMethod = d.submissionMethod as string || null;
    }
    return;
  }
  if (t === 'OASIS_EXPORT_BATCH_ACKNOWLEDGED' || t === 'OASIS_BATCH_ACKNOWLEDGED') {
    const batchId = d.exportBatchId as string || event.aggregateId;
    const batch = state.oasisBatches.get(batchId);
    if (batch) {
      batch.status = 'ACKNOWLEDGED';
      batch.oasisRefId = d.oasisRefId as string || null;
      batch.acknowledgedAt = d.acceptedAt ? new Date(d.acceptedAt as string) : event.ingestedAt;
    }
    return;
  }
  if (t === 'OASIS_EXPORT_BATCH_REJECTED' || t === 'OASIS_BATCH_REJECTED') {
    const batchId = d.exportBatchId as string || event.aggregateId;
    const batch = state.oasisBatches.get(batchId);
    if (batch) {
      batch.status = 'REJECTED';
      batch.rejectionReason = d.rejectionReason as string || null;
      batch.rejectionCode = d.rejectionCode as string || null;
    }
    return;
  }
  if (t === 'OASIS_EXPORT_BATCH_VOIDED') {
    const batchId = d.exportBatchId as string || event.aggregateId;
    const batch = state.oasisBatches.get(batchId);
    if (batch) {
      batch.status = 'VOIDED';
      batch.voidedReason = d.reason as string || null;
      batch.voidedByActorId = d.voidedByActorId as string || null;
    }
    return;
  }

  // --- CLOSEOUT EVENTS ---
  if (t === 'GRANT_CYCLE_CLOSEOUT_PREFLIGHT_COMPLETED') {
    const cycleId = event.grantCycleId;
    let co = state.closeouts.get(cycleId);
    if (!co) {
      co = { grantCycleId: cycleId, closeoutStatus: 'NOT_STARTED', preflightStatus: null, preflightChecks: null, startedAt: null, reconciledAt: null, financialSummary: null, matchingFunds: null, activitySummary: null, reconciliationWmIngestedAt: null, reconciliationWmEventId: null, closedAt: null, closedByActorId: null, finalBalanceCents: null, auditHoldReason: null, auditHoldAt: null, auditResolvedAt: null, auditResolution: null };
      state.closeouts.set(cycleId, co);
    }
    co.preflightStatus = d.status as string;
    co.preflightChecks = d.checks || null;
    co.closeoutStatus = d.status === 'PASSED' ? 'PREFLIGHT_PASSED' : 'PREFLIGHT_FAILED';
    return;
  }
  if (t === 'GRANT_CYCLE_CLOSEOUT_STARTED') {
    const cycleId = event.grantCycleId;
    let co = state.closeouts.get(cycleId);
    if (!co) {
      co = { grantCycleId: cycleId, closeoutStatus: 'NOT_STARTED', preflightStatus: null, preflightChecks: null, startedAt: null, reconciledAt: null, financialSummary: null, matchingFunds: null, activitySummary: null, reconciliationWmIngestedAt: null, reconciliationWmEventId: null, closedAt: null, closedByActorId: null, finalBalanceCents: null, auditHoldReason: null, auditHoldAt: null, auditResolvedAt: null, auditResolution: null };
      state.closeouts.set(cycleId, co);
    }
    co.closeoutStatus = 'STARTED';
    co.startedAt = event.ingestedAt;
    return;
  }
  if (t === 'GRANT_CYCLE_CLOSEOUT_RECONCILED') {
    const cycleId = event.grantCycleId;
    const co = state.closeouts.get(cycleId);
    if (co) {
      co.closeoutStatus = 'RECONCILED';
      co.reconciledAt = event.ingestedAt;
      co.financialSummary = d.financialSummary || null;
      co.matchingFunds = d.matchingFunds || null;
      co.activitySummary = d.activitySummary || null;
      co.reconciliationWmIngestedAt = d.watermarkIngestedAt ? new Date(d.watermarkIngestedAt as string) : null;
      co.reconciliationWmEventId = d.watermarkEventId as string || null;
    }
    return;
  }
  if (t === 'GRANT_CYCLE_CLOSED') {
    const cycleId = event.grantCycleId;
    const co = state.closeouts.get(cycleId);
    if (co) {
      co.closeoutStatus = 'CLOSED';
      co.closedAt = event.ingestedAt;
      co.closedByActorId = d.closedByActorId as string || null;
      co.finalBalanceCents = toBigInt(d.finalBalanceCents);
    }
    return;
  }
  if (t === 'GRANT_CYCLE_CLOSEOUT_AUDIT_HOLD') {
    const cycleId = event.grantCycleId;
    const co = state.closeouts.get(cycleId);
    if (co) {
      co.closeoutStatus = 'AUDIT_HOLD';
      co.auditHoldReason = d.reason as string || null;
      co.auditHoldAt = event.ingestedAt;
    }
    return;
  }
  if (t === 'GRANT_CYCLE_CLOSEOUT_AUDIT_RESOLVED') {
    const cycleId = event.grantCycleId;
    const co = state.closeouts.get(cycleId);
    if (co) {
      co.auditResolution = d.resolution as string || null;
      co.auditResolvedAt = event.ingestedAt;
      // Revert to pre-hold status
      if (co.reconciledAt) co.closeoutStatus = 'RECONCILED';
      else if (co.startedAt) co.closeoutStatus = 'STARTED';
      else co.closeoutStatus = co.preflightStatus === 'PASSED' ? 'PREFLIGHT_PASSED' : 'NOT_STARTED';
    }
    return;
  }

  // --- BREEDER COMPLIANCE EVENTS ---
  if (
    t === 'BREEDER_TRANSFER_CONFIRMATION_FILED' ||
    t === 'BREEDER_TRANSFER_CONFIRMATION_AMENDED' ||
    t === 'BREEDER_ACCIDENTAL_LITTER_REGISTRATION_FILED' ||
    t === 'BREEDER_ACCIDENTAL_LITTER_REGISTRATION_AMENDED' ||
    t === 'BREEDER_QUARTERLY_TRANSITION_REPORT_FILED' ||
    t === 'BREEDER_QUARTERLY_TRANSITION_REPORT_AMENDED'
  ) {
    const filingType = filingTypeFromEvent(t);
    if (!filingType) {
      return;
    }

    const filingId = event.aggregateId;
    const existing = state.breederComplianceQueue.get(filingId);
    const occurredAt = asDate(d.occurredAt) ?? existing?.occurredAt ?? event.occurredAt;
    const submittedAt = asDate(d.submittedAt) ?? event.ingestedAt;
    const amendedAt = t.endsWith('_AMENDED') ? event.ingestedAt : existing?.amendedAt ?? null;
    const existingCurePeriodDays = existing?.cureDeadlineAt
      ? Math.max(1, Math.ceil((existing.cureDeadlineAt.getTime() - existing.dueAt.getTime()) / (24 * 60 * 60 * 1000)))
      : null;
    const curePeriodDays = asNullableInteger(d.curePeriodDays) ?? existingCurePeriodDays;
    const reportingYear = asNullableInteger(d.reportingYear) ?? existing?.reportingYear ?? null;
    const reportingQuarter = asNullableInteger(d.reportingQuarter) ?? existing?.reportingQuarter ?? null;

    const dueAt = calculateDueAt({
      filingType,
      occurredAt: occurredAt ?? undefined,
      dueAt: asDate(d.dueAt) ?? existing?.dueAt,
      quarterlyCycle: (reportingYear && reportingQuarter && reportingQuarter >= 1 && reportingQuarter <= 4)
        ? { reportingYear, reportingQuarter: reportingQuarter as 1 | 2 | 3 | 4 }
        : undefined,
      quarterlyDueOffsetDays: asNullableInteger(d.quarterlyDueOffsetDays) ?? undefined,
    });

    const curedAt = asDate(d.curedAt) ?? existing?.curedAt ?? null;
    const status = calculateComplianceStatus({
      dueAt,
      asOf: event.ingestedAt,
      submittedAt,
      curedAt,
      curePeriodDays,
    });

    state.breederComplianceQueue.set(filingId, {
      filingId,
      licenseId: (typeof d.licenseId === 'string' && d.licenseId.length > 0) ? d.licenseId : existing?.licenseId ?? null,
      grantCycleId: event.grantCycleId,
      filingType,
      reportingYear,
      reportingQuarter,
      occurredAt,
      dueAt,
      cureDeadlineAt: calculateCureDeadlineAt(dueAt, curePeriodDays),
      submittedAt,
      amendedAt,
      curedAt,
      status,
      lastEventId: event.eventId,
      lastEventIngestedAt: event.ingestedAt,
    });
    return;
  }

  if (t === 'BREEDER_FILING_CURED') {
    const filingId = (typeof d.filingId === 'string' && d.filingId.length > 0) ? d.filingId : event.aggregateId;
    const existing = state.breederComplianceQueue.get(filingId);
    if (!existing) {
      return;
    }

    const curedAt = asDate(d.curedAt) ?? event.ingestedAt;
    existing.curedAt = curedAt;
    existing.status = 'CURED';
    existing.lastEventId = event.eventId;
    existing.lastEventIngestedAt = event.ingestedAt;
    return;
  }

  // All other events (FRAUD_SIGNAL_DETECTED, ATTACHMENT_ADDED, etc.) — no projection impact
}

// ============================================
// INSERT FUNCTIONS — write in-memory state to DB
// ============================================

async function insertApplicationsProjection(client: PoolClient, apps: Map<string, ApplicationState>, wm: ProjectionWatermark): Promise<void> {
  for (const app of apps.values()) {
    await client.query(
      `INSERT INTO applications_projection (application_id, grantee_id, grant_cycle_id, organization_name, organization_type, requested_amount_cents, match_commitment_cents, match_level, status, completeness_percent, priority_score, rebuilt_at, watermark_ingested_at, watermark_event_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [app.applicationId, app.granteeId, app.grantCycleId, app.organizationName, app.organizationType, app.requestedAmountCents?.toString() || null, app.matchCommitmentCents?.toString() || null, app.matchLevel, app.status, app.completenessPercent, app.priorityScore, wm.rebuiltAt, wm.watermarkIngestedAt, wm.watermarkEventId]
    );
  }
}

async function insertGrantBalancesProjection(client: PoolClient, buckets: Map<string, BucketState>, wm: ProjectionWatermark): Promise<void> {
  for (const b of buckets.values()) {
    await client.query(
      `INSERT INTO grant_balances_projection (grant_id, grant_cycle_id, bucket_type, awarded_cents, available_cents, encumbered_cents, liquidated_cents, released_cents, rate_numerator_cents, rate_denominator_cents, matching_committed_cents, matching_reported_cents, rebuilt_at, watermark_ingested_at, watermark_event_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [b.grantId, b.grantCycleId, b.bucketType, b.awardedCents.toString(), b.availableCents.toString(), b.encumberedCents.toString(), b.liquidatedCents.toString(), b.releasedCents.toString(), b.rateNumeratorCents.toString(), b.rateDenominatorCents.toString(), b.matchingCommittedCents.toString(), b.matchingReportedCents.toString(), wm.rebuiltAt, wm.watermarkIngestedAt, wm.watermarkEventId]
    );
  }
}

async function insertVouchersProjection(client: PoolClient, vouchers: Map<string, VoucherState>, wm: ProjectionWatermark): Promise<void> {
  for (const v of vouchers.values()) {
    await client.query(
      `INSERT INTO vouchers_projection (voucher_id, grant_id, voucher_code, county_code, status, max_reimbursement_cents, is_lirp, tentative_expires_at, expires_at, issued_at, redeemed_at, expired_at, voided_at, rebuilt_at, watermark_ingested_at, watermark_event_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [v.voucherId, v.grantId, v.voucherCode, v.countyCode, v.status, v.maxReimbursementCents.toString(), v.isLirp, v.tentativeExpiresAt, v.expiresAt, v.issuedAt, v.redeemedAt, v.expiredAt, v.voidedAt, wm.rebuiltAt, wm.watermarkIngestedAt, wm.watermarkEventId]
    );
  }
}

async function insertAllocatorsProjection(client: PoolClient, allocators: Map<string, AllocatorState>, wm: ProjectionWatermark): Promise<void> {
  for (const a of allocators.values()) {
    await client.query(
      `INSERT INTO allocators_projection (allocator_id, grant_cycle_id, county_code, next_sequence, rebuilt_at, watermark_ingested_at, watermark_event_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [a.allocatorId, a.grantCycleId, a.countyCode, a.nextSequence, wm.rebuiltAt, wm.watermarkIngestedAt, wm.watermarkEventId]
    );
  }
}

async function insertClinicsProjection(client: PoolClient, clinics: Map<string, ClinicState>, wm: ProjectionWatermark): Promise<void> {
  for (const c of clinics.values()) {
    await client.query(
      `INSERT INTO vet_clinics_projection (clinic_id, clinic_name, status, license_status, license_number, license_expires_at, oasis_vendor_code, payment_info, registered_at, suspended_at, reinstated_at, rebuilt_at, watermark_ingested_at, watermark_event_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [c.clinicId, c.clinicName, c.status, c.licenseStatus, c.licenseNumber, c.licenseExpiresAt, c.oasisVendorCode, c.paymentInfo ? JSON.stringify(c.paymentInfo) : null, c.registeredAt, c.suspendedAt, c.reinstatedAt, wm.rebuiltAt, wm.watermarkIngestedAt, wm.watermarkEventId]
    );
  }
}

async function insertClaimsProjection(client: PoolClient, claims: Map<string, ClaimState>, wm: ProjectionWatermark): Promise<void> {
  for (const cl of claims.values()) {
    await client.query(
      `INSERT INTO claims_projection (claim_id, claim_fingerprint, grant_cycle_id, voucher_id, clinic_id, procedure_code, date_of_service, status, submitted_amount_cents, approved_amount_cents, decision_basis, invoice_id, submitted_at, approved_at, approved_event_id, denied_at, adjusted_at, invoiced_at, rebuilt_at, watermark_ingested_at, watermark_event_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
      [cl.claimId, cl.claimFingerprint, cl.grantCycleId, cl.voucherId, cl.clinicId, cl.procedureCode, cl.dateOfService, cl.status, cl.submittedAmountCents.toString(), cl.approvedAmountCents?.toString() || null, cl.decisionBasis ? JSON.stringify(cl.decisionBasis) : null, cl.invoiceId, cl.submittedAt, cl.approvedAt, cl.approvedEventId, cl.deniedAt, cl.adjustedAt, cl.invoicedAt, wm.rebuiltAt, wm.watermarkIngestedAt, wm.watermarkEventId]
    );
  }
}

async function insertInvoicesProjection(client: PoolClient, invoices: Map<string, InvoiceState>, wm: ProjectionWatermark): Promise<void> {
  for (const inv of invoices.values()) {
    await client.query(
      `INSERT INTO invoices_projection (invoice_id, clinic_id, grant_cycle_id, invoice_period_start, invoice_period_end, total_amount_cents, claim_ids, adjustment_ids, status, submitted_at, generated_at, oasis_export_batch_id, rebuilt_at, watermark_ingested_at, watermark_event_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [inv.invoiceId, inv.clinicId, inv.grantCycleId, inv.periodStart, inv.periodEnd, inv.totalAmountCents.toString(), JSON.stringify(inv.claimIds), JSON.stringify(inv.adjustmentIds), inv.status, inv.submittedAt, inv.generatedAt, inv.oasisExportBatchId, wm.rebuiltAt, wm.watermarkIngestedAt, wm.watermarkEventId]
    );
  }
}

async function insertPaymentsProjection(client: PoolClient, payments: Map<string, PaymentState>, wm: ProjectionWatermark): Promise<void> {
  for (const p of payments.values()) {
    await client.query(
      `INSERT INTO payments_projection (payment_id, invoice_id, amount_cents, payment_channel, reference_id, recorded_at, rebuilt_at, watermark_ingested_at, watermark_event_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [p.paymentId, p.invoiceId, p.amountCents.toString(), p.paymentChannel, p.referenceId, p.recordedAt, wm.rebuiltAt, wm.watermarkIngestedAt, wm.watermarkEventId]
    );
  }
}

async function insertAdjustmentsProjection(client: PoolClient, adjustments: Map<string, AdjustmentState>, wm: ProjectionWatermark): Promise<void> {
  for (const adj of adjustments.values()) {
    await client.query(
      `INSERT INTO invoice_adjustments_projection (adjustment_id, source_invoice_id, grant_cycle_id, clinic_id, target_invoice_id, amount_cents, reason, recorded_at, applied_at, rebuilt_at, watermark_ingested_at, watermark_event_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [adj.adjustmentId, adj.sourceInvoiceId, adj.grantCycleId, adj.clinicId, adj.targetInvoiceId, adj.amountCents.toString(), adj.reason, adj.recordedAt, adj.appliedAt, wm.rebuiltAt, wm.watermarkIngestedAt, wm.watermarkEventId]
    );
  }
}

async function insertOasisBatchesProjection(client: PoolClient, batches: Map<string, OasisBatchState>, wm: ProjectionWatermark): Promise<void> {
  for (const b of batches.values()) {
    await client.query(
      `INSERT INTO oasis_export_batches_projection (export_batch_id, grant_cycle_id, batch_code, batch_fingerprint, period_start, period_end, watermark_ingested_at, watermark_event_id, status, record_count, control_total_cents, artifact_id, file_sha256, format_version, submitted_at, submission_method, oasis_ref_id, acknowledged_at, rejection_reason, rejection_code, voided_reason, voided_by_actor_id, rebuilt_at, watermark_ingested_at_row, watermark_event_id_row)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)`,
      [b.exportBatchId, b.grantCycleId, b.batchCode, b.batchFingerprint, b.periodStart, b.periodEnd, b.wmIngestedAt, b.wmEventId, b.status, b.recordCount, b.controlTotalCents.toString(), b.artifactId, b.fileSha256, b.formatVersion, b.submittedAt, b.submissionMethod, b.oasisRefId, b.acknowledgedAt, b.rejectionReason, b.rejectionCode, b.voidedReason, b.voidedByActorId, wm.rebuiltAt, wm.watermarkIngestedAt, wm.watermarkEventId]
    );
    // Insert batch items
    for (const item of b.items) {
      await client.query(
        `INSERT INTO oasis_export_batch_items_projection (export_batch_id, invoice_id, clinic_id, oasis_vendor_code, amount_cents, invoice_period_start, invoice_period_end)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [b.exportBatchId, item.invoiceId, item.clinicId, item.oasisVendorCode, item.amountCents.toString(), item.periodStart, item.periodEnd]
      );
    }
  }
}

async function insertCloseoutProjection(client: PoolClient, closeouts: Map<string, CloseoutState>, wm: ProjectionWatermark): Promise<void> {
  for (const co of closeouts.values()) {
    await client.query(
      `INSERT INTO grant_cycle_closeout_projection (grant_cycle_id, closeout_status, preflight_status, preflight_checks, started_at, reconciled_at, financial_summary, matching_funds, activity_summary, reconciliation_watermark_ingested_at, reconciliation_watermark_event_id, closed_at, closed_by_actor_id, final_balance_cents, audit_hold_reason, audit_hold_at, audit_resolved_at, audit_resolution, rebuilt_at, watermark_ingested_at, watermark_event_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
      [co.grantCycleId, co.closeoutStatus, co.preflightStatus, co.preflightChecks ? JSON.stringify(co.preflightChecks) : null, co.startedAt, co.reconciledAt, co.financialSummary ? JSON.stringify(co.financialSummary) : null, co.matchingFunds ? JSON.stringify(co.matchingFunds) : null, co.activitySummary ? JSON.stringify(co.activitySummary) : null, co.reconciliationWmIngestedAt, co.reconciliationWmEventId, co.closedAt, co.closedByActorId, co.finalBalanceCents?.toString() || null, co.auditHoldReason, co.auditHoldAt, co.auditResolvedAt, co.auditResolution, wm.rebuiltAt, wm.watermarkIngestedAt, wm.watermarkEventId]
    );
  }
}

async function insertBreederComplianceQueueProjection(client: PoolClient, filings: Map<string, BreederComplianceState>, wm: ProjectionWatermark): Promise<void> {
  for (const filing of filings.values()) {
    const recomputedStatus = calculateComplianceStatus({
      dueAt: filing.dueAt,
      asOf: wm.rebuiltAt,
      submittedAt: filing.submittedAt,
      curedAt: filing.curedAt,
      curePeriodDays: filing.cureDeadlineAt
        ? Math.max(1, Math.ceil((filing.cureDeadlineAt.getTime() - filing.dueAt.getTime()) / (24 * 60 * 60 * 1000)))
        : null,
    });

    await client.query(
      `INSERT INTO breeder_compliance_queue_projection (filing_id, license_id, grant_cycle_id, filing_type, reporting_year, reporting_quarter, occurred_at, due_at, cure_deadline_at, submitted_at, amended_at, cured_at, status, last_event_id, last_event_ingested_at, rebuilt_at, watermark_ingested_at, watermark_event_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [
        filing.filingId,
        filing.licenseId,
        filing.grantCycleId,
        filing.filingType,
        filing.reportingYear,
        filing.reportingQuarter,
        filing.occurredAt,
        filing.dueAt,
        filing.cureDeadlineAt,
        filing.submittedAt,
        filing.amendedAt,
        filing.curedAt,
        recomputedStatus,
        filing.lastEventId,
        filing.lastEventIngestedAt,
        wm.rebuiltAt,
        wm.watermarkIngestedAt,
        wm.watermarkEventId,
      ]
    );
  }
}

const ALL_PROJECTION_TABLES = [
  'oasis_export_batch_items_projection',  // FK child first
  'oasis_export_batches_projection',
  'grant_cycle_closeout_projection',
  'breeder_compliance_queue_projection',
  'invoice_adjustments_projection',
  'payments_projection',
  'invoices_projection',
  'claims_projection',
  'vet_clinics_projection',
  'allocators_projection',
  'vouchers_projection',
  'grant_balances_projection',
  'applications_projection',
];

async function truncateProjections(client: PoolClient): Promise<void> {
  await client.query(`TRUNCATE TABLE ${ALL_PROJECTION_TABLES.join(', ')} CASCADE`);
}

function computeWatermark(lastEvent: DomainEvent | null, rebuiltAt: Date): ProjectionWatermark {
  if (!lastEvent) {
    return {
      rebuiltAt,
      watermarkIngestedAt: Watermark.ZERO.ingestedAt,
      watermarkEventId: Watermark.ZERO.eventId,
    };
  }

  return {
    rebuiltAt,
    watermarkIngestedAt: lastEvent.ingestedAt,
    watermarkEventId: lastEvent.eventId,
  };
}

export interface RebuildResult {
  rebuiltAt: string;
  eventsReplayed: number;
  projectionsRebuilt: string[];
  watermark: {
    ingestedAt: string;
    eventId: string;
  };
}

export async function rebuildAllProjections(pool: Pool): Promise<RebuildResult> {
  const store = new EventStore(pool);
  const state = createEmptyState();

  let watermark = Watermark.ZERO;
  let lastEvent: DomainEvent | null = null;
  let eventsReplayed = 0;

  while (true) {
    const events = await store.fetchSince(watermark, 1000);
    if (events.length === 0) {
      break;
    }

    for (const event of events) {
      ensureAllowedEvent(event);
      dispatchEvent(state, event);
      lastEvent = event;
      eventsReplayed += 1;
    }

    watermark = Watermark.from(events[events.length - 1]);
  }

  const rebuiltAt = new Date();
  const projectionWatermark = computeWatermark(lastEvent, rebuiltAt);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await truncateProjections(client);
    await insertApplicationsProjection(client, state.applications, projectionWatermark);
    await insertGrantBalancesProjection(client, state.grantBuckets, projectionWatermark);
    await insertVouchersProjection(client, state.vouchers, projectionWatermark);
    await insertAllocatorsProjection(client, state.allocators, projectionWatermark);
    await insertClinicsProjection(client, state.clinics, projectionWatermark);
    await insertClaimsProjection(client, state.claims, projectionWatermark);
    await insertInvoicesProjection(client, state.invoices, projectionWatermark);
    await insertPaymentsProjection(client, state.payments, projectionWatermark);
    await insertAdjustmentsProjection(client, state.adjustments, projectionWatermark);
    await insertOasisBatchesProjection(client, state.oasisBatches, projectionWatermark);
    await insertCloseoutProjection(client, state.closeouts, projectionWatermark);
    await insertBreederComplianceQueueProjection(client, state.breederComplianceQueue, projectionWatermark);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  return {
    rebuiltAt: rebuiltAt.toISOString(),
    eventsReplayed,
    projectionsRebuilt: ALL_PROJECTION_TABLES,
    watermark: {
      ingestedAt: projectionWatermark.watermarkIngestedAt.toISOString(),
      eventId: projectionWatermark.watermarkEventId,
    },
  };
}
