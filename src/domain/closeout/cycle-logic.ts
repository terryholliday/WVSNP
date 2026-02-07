import { MoneyCents, Money } from '../../domain-types';

export type CloseoutStatus = 
  | 'NOT_STARTED'
  | 'PREFLIGHT_FAILED'
  | 'PREFLIGHT_PASSED'
  | 'STARTED'
  | 'RECONCILED'
  | 'AUDIT_HOLD'
  | 'CLOSED';

export interface PreflightCheck {
  check: string;
  pass: boolean;
  details: string;
}

export interface FinancialSummary {
  awardedCents: MoneyCents;
  encumberedCents: MoneyCents;
  liquidatedCents: MoneyCents;
  releasedCents: MoneyCents;
  unspentCents: MoneyCents;
}

export interface MatchingFundsSummary {
  committedCents: MoneyCents;
  reportedCents: MoneyCents;
  shortfallCents: MoneyCents;
  surplusCents: MoneyCents;
  evidenceArtifactIds: string[];
}

export interface ActivitySummary {
  vouchersIssued: number;
  vouchersRedeemed: number;
  vouchersExpired: number;
  vouchersVoided: number;
  claimsSubmitted: number;
  claimsApproved: number;
  claimsDenied: number;
  claimsAdjusted: number;
  invoicesGenerated: number;
  invoicesPaid: number;
  dogSpays: number;
  dogNeuters: number;
  catSpays: number;
  catNeuters: number;
  communityCatSpays: number;
  communityCatNeuters: number;
  totalAnimalsServed: number;
  countiesCovered: string[];
}

export interface CycleCloseoutState {
  grantCycleId: string;
  closeoutStatus: CloseoutStatus;
  preflightStatus: 'PASSED' | 'FAILED' | null;
  preflightChecks: PreflightCheck[];
  startedAt: Date | null;
  reconciledAt: Date | null;
  financialSummary: FinancialSummary | null;
  matchingFunds: MatchingFundsSummary | null;
  activitySummary: ActivitySummary | null;
  reconciliationWatermarkIngestedAt: Date | null;
  reconciliationWatermarkEventId: string | null;
  closedAt: Date | null;
  closedByActorId: string | null;
  finalBalanceCents: MoneyCents | null;
  auditHoldReason: string | null;
  auditHoldAt: Date | null;
  auditResolvedAt: Date | null;
  auditResolution: string | null;
}

export function createInitialCycleCloseoutState(grantCycleId: string): CycleCloseoutState {
  return {
    grantCycleId,
    closeoutStatus: 'NOT_STARTED',
    preflightStatus: null,
    preflightChecks: [],
    startedAt: null,
    reconciledAt: null,
    financialSummary: null,
    matchingFunds: null,
    activitySummary: null,
    reconciliationWatermarkIngestedAt: null,
    reconciliationWatermarkEventId: null,
    closedAt: null,
    closedByActorId: null,
    finalBalanceCents: null,
    auditHoldReason: null,
    auditHoldAt: null,
    auditResolvedAt: null,
    auditResolution: null,
  };
}

export function applyCycleCloseoutEvent(state: CycleCloseoutState, event: any): void {
  const { eventType, eventData, ingestedAt } = event;

  if (eventType === 'GRANT_CYCLE_CLOSEOUT_PREFLIGHT_COMPLETED') {
    state.preflightStatus = eventData.status as 'PASSED' | 'FAILED';
    state.preflightChecks = eventData.checks as PreflightCheck[];
    state.closeoutStatus = eventData.status === 'PASSED' ? 'PREFLIGHT_PASSED' : 'PREFLIGHT_FAILED';
  }

  if (eventType === 'GRANT_CYCLE_CLOSEOUT_STARTED') {
    state.closeoutStatus = 'STARTED';
    state.startedAt = ingestedAt;
  }

  if (eventType === 'GRANT_CYCLE_CLOSEOUT_RECONCILED') {
    state.closeoutStatus = 'RECONCILED';
    state.reconciledAt = ingestedAt;
    state.reconciliationWatermarkIngestedAt = new Date(eventData.watermarkIngestedAt as string);
    state.reconciliationWatermarkEventId = eventData.watermarkEventId as string;
    
    const fs = eventData.financialSummary as any;
    state.financialSummary = {
      awardedCents: Money.fromJSON(fs.awardedCents),
      encumberedCents: Money.fromJSON(fs.encumberedCents),
      liquidatedCents: Money.fromJSON(fs.liquidatedCents),
      releasedCents: Money.fromJSON(fs.releasedCents),
      unspentCents: Money.fromJSON(fs.unspentCents),
    };

    const mf = eventData.matchingFunds as any;
    const committedCents = Money.fromJSON(mf.committedCents);
    const reportedCents = Money.fromJSON(mf.reportedCents);
    const shortfallCents = (mf.shortfallCents !== undefined && mf.shortfallCents !== null)
      ? Money.fromJSON(mf.shortfallCents)
      : Money.fromBigInt(committedCents > reportedCents ? committedCents - reportedCents : 0n);
    const surplusCents = (mf.surplusCents !== undefined && mf.surplusCents !== null)
      ? Money.fromJSON(mf.surplusCents)
      : Money.fromBigInt(reportedCents > committedCents ? reportedCents - committedCents : 0n);

    state.matchingFunds = {
      committedCents,
      reportedCents,
      shortfallCents,
      surplusCents,
      evidenceArtifactIds: Array.isArray(mf.evidenceArtifactIds) ? mf.evidenceArtifactIds as string[] : [],
    };

    state.activitySummary = eventData.activitySummary as ActivitySummary;
  }

  if (eventType === 'GRANT_CYCLE_CLOSED') {
    state.closeoutStatus = 'CLOSED';
    state.closedAt = ingestedAt;
    state.closedByActorId = eventData.closedByActorId as string;
    state.finalBalanceCents = Money.fromJSON(eventData.finalBalanceCents as string);
  }

  if (eventType === 'GRANT_CYCLE_CLOSEOUT_AUDIT_HOLD') {
    state.closeoutStatus = 'AUDIT_HOLD';
    state.auditHoldReason = eventData.reason as string;
    state.auditHoldAt = ingestedAt;
  }

  if (eventType === 'GRANT_CYCLE_CLOSEOUT_AUDIT_RESOLVED') {
    state.auditResolution = eventData.resolution as string;
    state.auditResolvedAt = ingestedAt;
    if (state.reconciledAt) {
      state.closeoutStatus = 'RECONCILED';
    } else if (state.startedAt) {
      state.closeoutStatus = 'STARTED';
    } else if (state.preflightStatus === 'PASSED') {
      state.closeoutStatus = 'PREFLIGHT_PASSED';
    } else if (state.preflightStatus === 'FAILED') {
      state.closeoutStatus = 'PREFLIGHT_FAILED';
    } else {
      state.closeoutStatus = 'NOT_STARTED';
    }
  }
}

export function checkCycleCloseoutInvariant(state: CycleCloseoutState): void {
  if (state.closeoutStatus === 'RECONCILED' || state.closeoutStatus === 'CLOSED') {
    if (!state.financialSummary) {
      throw new Error('CLOSEOUT_INVARIANT: RECONCILED requires financialSummary');
    }
    if (!state.matchingFunds) {
      throw new Error('CLOSEOUT_INVARIANT: RECONCILED requires matchingFunds');
    }
    if (!state.activitySummary) {
      throw new Error('CLOSEOUT_INVARIANT: RECONCILED requires activitySummary');
    }

    // Financial invariant: awarded === liquidated + released + unspent
    const sum = state.financialSummary.liquidatedCents + 
                state.financialSummary.releasedCents + 
                state.financialSummary.unspentCents;
    if (sum !== state.financialSummary.awardedCents) {
      throw new Error('CLOSEOUT_INVARIANT: awardedCents !== liquidatedCents + releasedCents + unspentCents');
    }

    // Matching funds invariant: shortfall/surplus clamp to zero
    const committed = state.matchingFunds.committedCents;
    const reported = state.matchingFunds.reportedCents;
    const expectedShortfall = committed > reported ? committed - reported : 0n;
    const expectedSurplus = reported > committed ? reported - committed : 0n;
    if (expectedShortfall !== state.matchingFunds.shortfallCents) {
      throw new Error('CLOSEOUT_INVARIANT: shortfallCents !== max(committedCents - reportedCents, 0)');
    }
    if (expectedSurplus !== state.matchingFunds.surplusCents) {
      throw new Error('CLOSEOUT_INVARIANT: surplusCents !== max(reportedCents - committedCents, 0)');
    }
    if (state.matchingFunds.shortfallCents > 0n && state.matchingFunds.surplusCents > 0n) {
      throw new Error('CLOSEOUT_INVARIANT: shortfallCents and surplusCents cannot both be positive');
    }
  }

  if (state.closeoutStatus === 'CLOSED' && !state.closedByActorId) {
    throw new Error('CLOSEOUT_INVARIANT: CLOSED requires closedByActorId');
  }
}

export function canStartCloseout(state: CycleCloseoutState): { allowed: boolean; reason?: string } {
  if (state.closeoutStatus !== 'PREFLIGHT_PASSED') {
    return { allowed: false, reason: 'PREFLIGHT_NOT_PASSED' };
  }
  return { allowed: true };
}

export function canCloseout(state: CycleCloseoutState): { allowed: boolean; reason?: string } {
  if (state.closeoutStatus === 'AUDIT_HOLD') {
    return { allowed: false, reason: 'AUDIT_HOLD_ACTIVE' };
  }
  if (state.closeoutStatus !== 'RECONCILED') {
    return { allowed: false, reason: 'NOT_RECONCILED' };
  }
  return { allowed: true };
}

/**
 * Check if an event type is blocked after cycle is closed
 */
export function isEventBlockedAfterClose(eventType: string): boolean {
  const blockedEvents = [
    'VOUCHER_ISSUED',
    'VOUCHER_ISSUED_TENTATIVE',
    'CLAIM_SUBMITTED',
    'CLAIM_APPROVED',
    'CLAIM_ADJUSTED',
    'INVOICE_GENERATED',
    'GRANT_FUNDS_ENCUMBERED',
    'GRANT_FUNDS_LIQUIDATED',
  ];
  return blockedEvents.includes(eventType);
}

/**
 * Check if an event type is still allowed after cycle is closed
 */
export function isEventAllowedAfterClose(eventType: string): boolean {
  const allowedEvents = [
    'PAYMENT_RECORDED',
    'PAYMENT_SHORTFALL_FLAGGED',
    'PAYMENT_SHORTFALL_RESOLVED',
    'OASIS_EXPORT_BATCH_CREATED',
    'OASIS_EXPORT_BATCH_ITEM_ADDED',
    'OASIS_EXPORT_FILE_RENDERED',
    'OASIS_EXPORT_BATCH_SUBMITTED',
    'OASIS_EXPORT_BATCH_ACKNOWLEDGED',
    'OASIS_EXPORT_BATCH_REJECTED',
    'OASIS_EXPORT_BATCH_VOIDED',
    'GRANT_CYCLE_CLOSEOUT_ARTIFACT_ATTACHED',
    'GRANT_CYCLE_CLOSEOUT_AUDIT_HOLD',
    'GRANT_CYCLE_CLOSEOUT_AUDIT_RESOLVED',
  ];
  return allowedEvents.includes(eventType);
}
