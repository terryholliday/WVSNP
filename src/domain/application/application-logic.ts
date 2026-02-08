import { Money } from '../../domain-types';
import {
  ApplicationState,
  ApplicationEvent,
  ApplicationId,
  GranteeId,
  ApplicationSection,
  FraudSignal,
} from './application-types';

/**
 * Creates initial application state for a new application
 */
export function createInitialApplicationState(applicationId: ApplicationId): ApplicationState {
  return {
    applicationId,
    granteeId: '' as GranteeId, // Will be set on APPLICATION_STARTED
    grantCycleId: '',

    organizationName: '',
    organizationType: 'OTHER',

    requestedAmountCents: Money.fromBigInt(0n),
    matchCommitmentCents: Money.fromBigInt(0n),

    status: 'DRAFT',
    submittedAt: null,
    decisionAt: null,

    sectionsCompleted: {},
    completenessPercent: 0,

    priorityScore: null,

    evidenceRefs: [],
    fraudSignals: []
  };
}

/**
 * Applies an application event to update the state
 */
export function applyApplicationEvent(state: ApplicationState, event: ApplicationEvent): ApplicationState {
  switch (event.eventType) {
    case 'APPLICATION_STARTED':
      return {
        ...state,
        granteeId: event.eventData.granteeId,
        grantCycleId: event.eventData.grantCycleId,
        organizationName: event.eventData.organizationName,
        organizationType: event.eventData.organizationType,
        status: 'DRAFT'
      };

    case 'APPLICATION_SUBMITTED':
      return {
        ...state,
        requestedAmountCents: Money.fromString(event.eventData.requestedAmountCents),
        matchCommitmentCents: Money.fromString(event.eventData.matchCommitmentCents),
        sectionsCompleted: Object.fromEntries(
          event.eventData.sectionsCompleted.map(section => [section, true])
        ),
        completenessPercent: 100, // All sections completed by definition
        status: 'SUBMITTED',
        submittedAt: event.occurredAt
      };

    case 'APPLICATION_SECTION_COMPLETED': {
      const updatedSections = { ...state.sectionsCompleted, [event.eventData.section]: true };
      return {
        ...state,
        sectionsCompleted: updatedSections,
        completenessPercent: calculateCompleteness(updatedSections)
      };
    }

    case 'ATTACHMENT_ADDED':
    case 'APPLICATION_EVIDENCE_ATTACHED': // legacy compat
      return {
        ...state,
        evidenceRefs: [...state.evidenceRefs, event.eventData.evidenceRefId]
      };

    case 'APPLICATION_SCORED':
      return {
        ...state,
        priorityScore: event.eventData.priorityScore,
        status: 'SCORED'
      };

    case 'APPLICATION_AWARDED':
      return {
        ...state,
        status: 'AWARDED',
        decisionAt: event.occurredAt
      };

    case 'APPLICATION_DENIED':
      return {
        ...state,
        status: 'DENIED',
        decisionAt: event.occurredAt
      };

    case 'APPLICATION_WAITLISTED':
      return {
        ...state,
        status: 'WAITLISTED',
        decisionAt: event.occurredAt
      };

    case 'APPLICATION_TOKEN_CONSUMED':
      return state; // Metadata event — no state change

    case 'FRAUD_SIGNAL_DETECTED':
      const newSignal: FraudSignal = {
        signalId: event.eventData.signalId,
        signalCode: event.eventData.signalCode,
        severity: event.eventData.severity,
        evidence: event.eventData.evidence,
        detectedAt: event.occurredAt,
        recommendedAction: event.eventData.recommendedAction
      };
      return {
        ...state,
        fraudSignals: [...state.fraudSignals, newSignal]
      };

    default:
      return state;
  }
}

/**
 * Validates application state invariants
 */
export function checkApplicationInvariant(state: ApplicationState): void {
  // Status progression invariants
  if (state.status === 'SUBMITTED' && !state.submittedAt) {
    throw new Error('APPLICATION_INVARIANT: SUBMITTED status requires submittedAt timestamp');
  }

  if (state.status === 'AWARDED' && !state.decisionAt) {
    throw new Error('APPLICATION_INVARIANT: AWARDED status requires decisionAt timestamp');
  }

  if (state.status === 'DENIED' && !state.decisionAt) {
    throw new Error('APPLICATION_INVARIANT: DENIED status requires decisionAt timestamp');
  }

  // Financial invariants
  if (state.requestedAmountCents < 0n) {
    throw new Error('APPLICATION_INVARIANT: requestedAmountCents cannot be negative');
  }

  if (state.matchCommitmentCents < 0n) {
    throw new Error('APPLICATION_INVARIANT: matchCommitmentCents cannot be negative');
  }

  // Completeness invariants
  if (state.status === 'SUBMITTED' && state.completenessPercent < 100) {
    throw new Error('APPLICATION_INVARIANT: SUBMITTED applications must be 100% complete');
  }

  if (state.completenessPercent < 0 || state.completenessPercent > 100) {
    throw new Error('APPLICATION_INVARIANT: completenessPercent must be between 0 and 100');
  }

  // Priority score invariants
  if (state.priorityScore !== null && (state.priorityScore < 0 || state.priorityScore > 100)) {
    throw new Error('APPLICATION_INVARIANT: priorityScore must be between 0 and 100 when present');
  }

  // Status-specific invariants
  if (state.status === 'SCORED' && state.priorityScore === null) {
    throw new Error('APPLICATION_INVARIANT: SCORED status requires priorityScore');
  }

  // Evidence invariants
  if (state.evidenceRefs.length > 50) {
    throw new Error('APPLICATION_INVARIANT: Maximum 50 evidence attachments allowed');
  }

  // Fraud signal invariants (advisory, so no blocking constraints)
}

/**
 * Calculates completeness percentage based on completed sections
 */
export function calculateCompleteness(sectionsCompleted: Record<string, boolean>): number {
  const requiredSections: ApplicationSection[] = [
    'ORGANIZATION_INFO',
    'SERVICE_AREA',
    'FINANCIAL_REQUEST',
    'CAPACITY_PLAN',
    'EVIDENCE_UPLOAD',
    'CERTIFICATION'
  ];

  const completedCount = requiredSections.filter(section => sectionsCompleted[section]).length;
  return Math.round((completedCount / requiredSections.length) * 100);
}

/**
 * Determines if application can be submitted
 */
export function canSubmitApplication(state: ApplicationState): boolean {
  return (
    state.status === 'DRAFT' &&
    state.organizationName.trim().length > 0 &&
    state.requestedAmountCents > 0n &&
    state.completenessPercent === 100
  );
}

/**
 * Gets critical fraud signals (severity HIGH or CRITICAL)
 */
export function getCriticalFraudSignals(state: ApplicationState): FraudSignal[] {
  return state.fraudSignals.filter(signal =>
    signal.severity === 'HIGH' || signal.severity === 'CRITICAL'
  );
}

/**
 * Determines if application should be flagged for review
 */
export function shouldFlagForReview(state: ApplicationState): boolean {
  return getCriticalFraudSignals(state).length > 0 ||
         (state.priorityScore !== null && state.priorityScore < 25);
}
