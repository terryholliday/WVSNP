/**
 * WVSNP-GMS REST API Types
 * Phase A5: API Layer for VetOS/ShelterOS/WVDA Integration
 */

// ============================================
// COMMON TYPES
// ============================================

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

export interface PaginatedResponse<T> {
  items: T[];
  pagination: {
    offset: number;
    limit: number;
    total: number;
    hasMore: boolean;
  };
}

// ============================================
// AUTHENTICATION
// ============================================

export type ApiClientType = 'CLINIC' | 'GRANTEE' | 'ADMIN';

export interface ApiCredentials {
  apiKeyId: string;
  clientType: ApiClientType;
  clientId: string; // clinicId for CLINIC, granteeId for GRANTEE, adminUserId for ADMIN
  grantCycleId: string;
  permissions: string[];
}

// ============================================
// VOUCHER TYPES (ShelterOS Integration)
// ============================================

export interface IssueVoucherRequest {
  voucherId?: string; // Optional - server generates if not provided
  grantId: string;
  countyCode: string;
  maxReimbursementCents: string; // BigInt as string
  isLIRP: boolean;
  recipientType: 'PET_OWNER' | 'COMMUNITY_CAT';
  recipientName: string;
  recipientPhone?: string;
  recipientAddress?: string;
  animalType: 'DOG' | 'CAT';
  procedureType: 'SPAY' | 'NEUTER';
  expiresAt: string; // ISO date
  incomeVerificationArtifactId?: string; // Required if LIRP
}

export interface VoucherResponse {
  voucherId: string;
  voucherCode: string;
  grantId: string;
  countyCode: string;
  status: 'TENTATIVE' | 'ISSUED' | 'REDEEMED' | 'EXPIRED' | 'VOIDED';
  maxReimbursementCents: string;
  isLIRP: boolean;
  recipientType: string;
  recipientName: string;
  animalType: string;
  procedureType: string;
  issuedAt: string | null;
  expiresAt: string;
  redeemedAt: string | null;
  expiredAt: string | null;
  voidedAt: string | null;
}

export interface VoucherStatusResponse {
  voucherId: string;
  voucherCode: string;
  status: 'TENTATIVE' | 'ISSUED' | 'REDEEMED' | 'EXPIRED' | 'VOIDED';
  isValid: boolean;
  canRedeem: boolean;
  maxReimbursementCents: string;
  isLIRP: boolean;
  expiresAt: string;
  redeemedAt: string | null;
  redeemedByClinicId: string | null;
  claimId: string | null;
}

export interface ValidateVoucherRequest {
  voucherCode: string;
  clinicId: string;
  procedureType: 'SPAY' | 'NEUTER';
  animalType: 'DOG' | 'CAT';
}

export interface ValidateVoucherResponse {
  valid: boolean;
  voucherId: string;
  maxReimbursementCents: string;
  isLIRP: boolean;
  coPayForbidden: boolean;
  expiresAt: string;
  errors: string[];
}

// ============================================
// CLAIM TYPES (VetOS Integration)
// ============================================

export interface SubmitClaimRequest {
  claimId?: string; // Optional - client can provide UUIDv4
  voucherId: string;
  clinicId: string;
  procedureCode: string;
  dateOfService: string; // ISO date
  submittedAmountCents: string;
  coPayCollectedCents?: string;
  rabiesVaccineIncluded: boolean;
  artifacts: {
    procedureReportId: string;
    clinicInvoiceId: string;
    rabiesCertificateId?: string;
    coPayReceiptId?: string;
  };
}

export interface ClaimResponse {
  claimId: string;
  voucherId: string;
  clinicId: string;
  grantCycleId: string;
  procedureCode: string;
  dateOfService: string;
  status: 'SUBMITTED' | 'APPROVED' | 'DENIED' | 'ADJUSTED' | 'INVOICED';
  submittedAmountCents: string;
  approvedAmountCents: string | null;
  decisionBasis: {
    policySnapshotId: string;
    decidedBy: string;
    decidedAt: string;
    reason: string;
  } | null;
  submittedAt: string;
  approvedAt: string | null;
  deniedAt: string | null;
  invoicedAt: string | null;
  invoiceId: string | null;
}

export interface ClaimStatusResponse {
  claimId: string;
  status: 'SUBMITTED' | 'APPROVED' | 'DENIED' | 'ADJUSTED' | 'INVOICED';
  approvedAmountCents: string | null;
  reason: string | null;
  invoiceId: string | null;
  paymentStatus: 'PENDING' | 'PAID' | 'PARTIALLY_PAID' | null;
}

export interface AdjudicateClaimRequest {
  decision: 'APPROVE' | 'DENY';
  approvedAmountCents?: string; // Required if APPROVE
  reason: string;
  policySnapshotId: string;
}

// ============================================
// PAYMENT TYPES (VetOS reads)
// ============================================

export interface PaymentResponse {
  paymentId: string;
  invoiceId: string;
  clinicId: string;
  amountCents: string;
  paymentChannel: string;
  referenceId: string | null;
  recordedAt: string;
}

export interface ClinicPaymentSummary {
  clinicId: string;
  totalPaidCents: string;
  totalPendingCents: string;
  payments: PaymentResponse[];
}

// ============================================
// GRANT TYPES (ShelterOS + WVDA)
// ============================================

export interface GrantBudgetResponse {
  grantId: string;
  grantCycleId: string;
  buckets: {
    type: 'GENERAL' | 'LIRP';
    awardedCents: string;
    availableCents: string;
    encumberedCents: string;
    liquidatedCents: string;
  }[];
  totals: {
    awardedCents: string;
    availableCents: string;
    encumberedCents: string;
    liquidatedCents: string;
  };
}

export interface ActivitySummaryResponse {
  grantId: string;
  grantCycleId: string;
  vouchers: {
    issued: number;
    redeemed: number;
    expired: number;
    voided: number;
    pending: number;
  };
  claims: {
    submitted: number;
    approved: number;
    denied: number;
    invoiced: number;
  };
  animals: {
    dogs: { spay: number; neuter: number };
    cats: { spay: number; neuter: number };
    communityCats: { spay: number; neuter: number };
  };
  counties: string[];
}

export interface CountyReportResponse {
  countyCode: string;
  grantCycleId: string;
  periodStart: string;
  periodEnd: string;
  vouchers: {
    issued: number;
    redeemed: number;
    spentCents: string;
    remainingCents: string;
  };
  procedures: {
    dogSpay: number;
    dogNeuter: number;
    catSpay: number;
    catNeuter: number;
  };
}

// ============================================
// INVOICE TYPES (WVDA Admin)
// ============================================

export interface GenerateInvoiceRequest {
  grantCycleId: string;
  periodStart: string; // ISO date
  periodEnd: string; // ISO date
}

export interface InvoiceResponse {
  invoiceId: string;
  clinicId: string;
  grantCycleId: string;
  periodStart: string;
  periodEnd: string;
  totalAmountCents: string;
  claimCount: number;
  status: 'DRAFT' | 'SUBMITTED' | 'PAID' | 'PARTIALLY_PAID';
  submittedAt: string | null;
  oasisExportBatchId: string | null;
}

// ============================================
// OASIS EXPORT TYPES (WVDA Admin)
// ============================================

export interface GenerateOASISBatchRequest {
  grantCycleId: string;
  periodStart: string;
  periodEnd: string;
}

export interface OASISBatchResponse {
  exportBatchId: string;
  batchCode: string;
  grantCycleId: string;
  periodStart: string;
  periodEnd: string;
  status: 'CREATED' | 'RENDERED' | 'SUBMITTED' | 'ACKNOWLEDGED' | 'REJECTED' | 'VOIDED';
  recordCount: number;
  controlTotalCents: string;
  artifactId: string | null;
  submittedAt: string | null;
  acknowledgedAt: string | null;
  rejectionReason: string | null;
}

export interface SubmitOASISBatchRequest {
  submissionMethod: 'SFTP' | 'MANUAL';
  oasisRefId?: string;
}

// ============================================
// CLOSEOUT TYPES (WVDA Admin)
// ============================================

export interface PreflightResponse {
  grantCycleId: string;
  status: 'PASSED' | 'FAILED';
  checks: {
    check: string;
    pass: boolean;
    details: string;
  }[];
}

export interface CloseoutStatusResponse {
  grantCycleId: string;
  status: 'NOT_STARTED' | 'PREFLIGHT_IN_PROGRESS' | 'STARTED' | 'RECONCILED' | 'CLOSED' | 'AUDIT_HOLD';
  preflightStatus: 'PASSED' | 'FAILED' | null;
  financialSummary: {
    awardedCents: string;
    liquidatedCents: string;
    releasedCents: string;
    unspentCents: string;
  } | null;
  activitySummary: {
    vouchersIssued: number;
    vouchersRedeemed: number;
    claimsApproved: number;
    invoicesGenerated: number;
  } | null;
  auditHoldReason: string | null;
  closedAt: string | null;
}

// ============================================
// WEBHOOK TYPES (GMS outbound)
// ============================================

export interface WebhookPayload {
  webhookId: string;
  eventType: string;
  timestamp: string;
  data: Record<string, unknown>;
}

export interface ClaimStatusChangedWebhook extends WebhookPayload {
  eventType: 'CLAIM_STATUS_CHANGED';
  data: {
    claimId: string;
    clinicId: string;
    status: string;
    reason: string | null;
    amountCents: string | null;
  };
}

export interface PaymentRecordedWebhook extends WebhookPayload {
  eventType: 'PAYMENT_RECORDED';
  data: {
    clinicId: string;
    invoiceId: string;
    amountCents: string;
    depositDate: string;
  };
}

export interface VoucherRedeemedWebhook extends WebhookPayload {
  eventType: 'VOUCHER_REDEEMED';
  data: {
    voucherId: string;
    clinicId: string;
    claimId: string;
    dateOfService: string;
  };
}
