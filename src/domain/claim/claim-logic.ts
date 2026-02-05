import { MoneyCents, Money, ClaimId, ClaimFingerprint, VoucherId } from '../../domain-types';

export type ClaimStatus = 'SUBMITTED' | 'APPROVED' | 'DENIED' | 'ADJUSTED' | 'INVOICED';

export interface DecisionBasis {
  policySnapshotId: string;
  decidedBy: string;
  decidedAt: Date;
  reason?: string;
}

export interface LicenseCheckEvidence {
  licenseNumber: string;
  licenseStatus: string;
  licenseExpiresAt: Date;
  licenseEvidenceSource: string;  // e.g., "WV Board portal", "uploaded doc", "manual entry"
  licenseCheckedAtOccurred: Date;  // UNTRUSTED: Client/business time (informational only)
  licenseCheckedAtIngested: Date;  // TRUSTED: Server truth timestamp (use for ordering/deadlines)
  validForDateOfService: boolean;
}

export interface ClaimState {
  claimId: ClaimId;
  claimFingerprint: ClaimFingerprint;
  grantCycleId: string;
  voucherId: VoucherId;
  clinicId: string;
  procedureCode: string;
  dateOfService: Date;
  status: ClaimStatus;
  submittedAmountCents: MoneyCents;
  approvedAmountCents: MoneyCents | null;
  decisionBasis: DecisionBasis | null;
  licenseCheckEvidence: LicenseCheckEvidence | null;
  invoiceId: string | null;
  submittedAt: Date | null;
  approvedAt: Date | null;
  approvedEventId: string | null;  // FIX: UUIDv7 from CLAIM_APPROVED event for watermark tuple
  deniedAt: Date | null;
  adjustedAt: Date | null;
  invoicedAt: Date | null;
}

export function createInitialClaimState(
  claimId: ClaimId,
  claimFingerprint: ClaimFingerprint,
  grantCycleId: string,
  voucherId: VoucherId,
  clinicId: string,
  procedureCode: string,
  dateOfService: Date
): ClaimState {
  return {
    claimId,
    claimFingerprint,
    grantCycleId,
    voucherId,
    clinicId,
    procedureCode,
    dateOfService,
    status: 'SUBMITTED',
    submittedAmountCents: Money.fromBigInt(0n),
    approvedAmountCents: null,
    decisionBasis: null,
    licenseCheckEvidence: null,
    invoiceId: null,
    submittedAt: null,
    approvedAt: null,
    approvedEventId: null,
    deniedAt: null,
    adjustedAt: null,
    invoicedAt: null,
  };
}

export function applyClaimEvent(state: ClaimState, event: any): void {
  const { eventType, eventData, ingestedAt, eventId } = event;

  if (eventType === 'CLAIM_SUBMITTED') {
    const submittedAmountCents = Money.fromJSON(eventData.submittedAmountCents as string);
    state.submittedAmountCents = submittedAmountCents;
    state.submittedAt = ingestedAt;
  }

  if (eventType === 'CLAIM_APPROVED') {
    if (state.status !== 'SUBMITTED' && state.status !== 'ADJUSTED') {
      throw new Error('CLAIM_NOT_SUBMITTED');
    }
    const approvedAmountCents = Money.fromJSON(eventData.approvedAmountCents as string);
    state.status = 'APPROVED';
    state.approvedAmountCents = approvedAmountCents;
    state.decisionBasis = {
      policySnapshotId: eventData.decisionBasis.policySnapshotId as string,
      decidedBy: eventData.decisionBasis.decidedBy as string,
      decidedAt: new Date(eventData.decisionBasis.decidedAt as string),
      reason: eventData.decisionBasis.reason as string | undefined,
    };
    state.approvedAt = ingestedAt;
    state.approvedEventId = eventId;  // FIX: Capture UUIDv7 for watermark tuple
  }

  if (eventType === 'CLAIM_DENIED') {
    if (state.status !== 'SUBMITTED' && state.status !== 'ADJUSTED') {
      throw new Error('CLAIM_NOT_SUBMITTED');
    }
    state.status = 'DENIED';
    state.decisionBasis = {
      policySnapshotId: eventData.decisionBasis.policySnapshotId as string,
      decidedBy: eventData.decisionBasis.decidedBy as string,
      decidedAt: new Date(eventData.decisionBasis.decidedAt as string),
      reason: eventData.decisionBasis.reason as string | undefined,
    };
    state.deniedAt = ingestedAt;
  }

  if (eventType === 'CLAIM_ADJUSTED') {
    const newAmountCents = Money.fromJSON(eventData.newAmountCents as string);
    state.status = 'ADJUSTED';
    state.approvedAmountCents = newAmountCents;
    state.adjustedAt = ingestedAt;
  }

  if (eventType === 'CLAIM_INVOICED') {
    if (state.status !== 'APPROVED') {
      throw new Error('CLAIM_NOT_APPROVED');
    }
    state.status = 'INVOICED';
    state.invoiceId = eventData.invoiceId as string;
    state.invoicedAt = ingestedAt;
  }

  if (eventType === 'CLAIM_DECISION_CONFLICT_RECORDED') {
    // This is a metadata event, doesn't change claim state
    // Just records that a conflict occurred
  }
}

export function checkClaimInvariant(state: ClaimState): void {
  if (state.status === 'APPROVED' && !state.approvedAmountCents) {
    throw new Error('APPROVED_WITHOUT_AMOUNT');
  }
  if (state.status === 'APPROVED' && !state.decisionBasis) {
    throw new Error('APPROVED_WITHOUT_DECISION_BASIS');
  }
  if (state.status === 'DENIED' && !state.decisionBasis) {
    throw new Error('DENIED_WITHOUT_DECISION_BASIS');
  }
  if (state.status === 'INVOICED' && !state.invoiceId) {
    throw new Error('INVOICED_WITHOUT_INVOICE_ID');
  }
}

export function validateClaimSubmission(
  dateOfService: Date,
  voucherIssuedAt: Date,
  voucherExpiresAt: Date,
  grantPeriodStart: Date,
  grantPeriodEnd: Date,
  submissionDeadline: Date,
  now: Date
): { valid: boolean; reason?: string } {
  // LAW 7.2: Procedure date must be within voucher validity AND grant period AND before submission deadline
  if (dateOfService < voucherIssuedAt) {
    return { valid: false, reason: 'DATE_OF_SERVICE_BEFORE_VOUCHER_ISSUED' };
  }
  if (dateOfService > voucherExpiresAt) {
    return { valid: false, reason: 'DATE_OF_SERVICE_AFTER_VOUCHER_EXPIRED' };
  }
  if (dateOfService < grantPeriodStart) {
    return { valid: false, reason: 'DATE_OF_SERVICE_BEFORE_GRANT_PERIOD' };
  }
  if (dateOfService > grantPeriodEnd) {
    return { valid: false, reason: 'DATE_OF_SERVICE_AFTER_GRANT_PERIOD' };
  }
  if (now > submissionDeadline) {
    return { valid: false, reason: 'SUBMISSION_DEADLINE_PASSED' };
  }
  return { valid: true };
}
