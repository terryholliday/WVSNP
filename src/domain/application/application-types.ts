import { MoneyCents } from '../../domain-types';

// Branded types for application domain
export type ApplicationId = string & { readonly brand: 'ApplicationId' };
export type GranteeId = string & { readonly brand: 'GranteeId' };
export type EvidenceRefId = string & { readonly brand: 'EvidenceRefId' };

// Application statuses - derived from event stream
export type ApplicationStatus =
  | 'DRAFT'           // Application started but not submitted
  | 'SUBMITTED'       // Submitted for review
  | 'UNDER_REVIEW'    // Being reviewed by admin
  | 'SCORED'          // Priority scoring completed
  | 'AWARDED'         // Grant awarded - triggers grant creation
  | 'WAITLISTED'      // Waitlisted for funding
  | 'DENIED'          // Application denied
  | 'WITHDRAWN';      // Applicant withdrew

// Organization types supported
export type OrganizationType =
  | 'MUNICIPAL_SHELTER'
  | 'NONPROFIT_RESCUE'
  | 'VETERINARY_CLINIC'
  | 'HUMANE_SOCIETY'
  | 'ANIMAL_CONTROL'
  | 'OTHER';

// Evidence types that can be attached
export type EvidenceType =
  | 'RESIDENCY_PROOF'
  | 'INCOME_VERIFICATION'
  | 'LICENSE_DOCUMENTATION'
  | 'SERVICE_AREA_MAP'
  | 'CAPACITY_DOCUMENTATION'
  | 'FINANCIAL_STATEMENT'
  | 'OTHER';

// Fraud signal severity levels (advisory only)
export type FraudSeverity =
  | 'LOW'
  | 'MEDIUM'
  | 'HIGH'
  | 'CRITICAL';

// Core application state - derived from events
export interface ApplicationState {
  applicationId: ApplicationId;
  granteeId: GranteeId;
  grantCycleId: string;  // VARCHAR(20) format like 'FY2026'

  // Organization info
  organizationName: string;
  organizationType: OrganizationType;

  // Financial request
  requestedAmountCents: MoneyCents;
  matchCommitmentCents: MoneyCents;

  // Status and lifecycle
  status: ApplicationStatus;
  submittedAt: Date | null;
  decisionAt: Date | null;

  // Completeness tracking
  sectionsCompleted: Record<string, boolean>;
  completenessPercent: number;

  // Scoring (admin-assigned)
  priorityScore: number | null;

  // Evidence references
  evidenceRefs: EvidenceRefId[];

  // Fraud signals (advisory)
  fraudSignals: FraudSignal[];
}

// Evidence attachment metadata
export interface EvidenceRef {
  evidenceRefId: EvidenceRefId;
  evidenceType: EvidenceType;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  storageKey: string;  // Opaque reference to storage location
  uploadedAt: Date;
}

// Fraud signal (advisory only - doesn't block submission)
export interface FraudSignal {
  signalId: string;  // UUIDv4
  signalCode: string; // Deterministic code like 'DUPLICATE_PHONE'
  severity: FraudSeverity;
  evidence: Record<string, any>; // Structured facts, not vibes
  detectedAt: Date;
  recommendedAction: string;
}

// Section completion tracking
export type ApplicationSection =
  | 'ORGANIZATION_INFO'
  | 'SERVICE_AREA'
  | 'FINANCIAL_REQUEST'
  | 'CAPACITY_PLAN'
  | 'EVIDENCE_UPLOAD'
  | 'CERTIFICATION';

// Command interfaces (public intake surface)
export interface StartApplicationCommand {
  commandId: string;
  applicationId: ApplicationId;
  granteeId: GranteeId;
  grantCycleId: string;

  // Initial organization info
  organizationName: string;
  organizationType: OrganizationType;

  // Context
  orgId: string;  // WVSNP Program Org
  actorId: string; // Public applicant principal
  correlationId: string;
  causationId: string | null;
  occurredAt: Date;
}

export interface SubmitApplicationCommand {
  commandId: string;
  applicationId: ApplicationId;

  // Financial request
  requestedAmountCents: MoneyCents;
  matchCommitmentCents: MoneyCents;

  // Completeness assertion
  sectionsCompleted: ApplicationSection[];

  // Context
  orgId: string;
  actorId: string;
  correlationId: string;
  causationId: string;
  occurredAt: Date;
}

export interface AttachEvidenceCommand {
  commandId: string;
  applicationId: ApplicationId;
  evidenceRefId: EvidenceRefId;
  evidenceType: EvidenceType;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  storageKey: string;

  // Context
  orgId: string;
  actorId: string;
  correlationId: string;
  causationId: string;
  occurredAt: Date;
}

// Event interfaces (repo-canon events)
export interface ApplicationStartedEvent {
  eventType: 'APPLICATION_STARTED';
  aggregateId: ApplicationId;
  aggregateType: 'APPLICATION';
  eventData: {
    granteeId: GranteeId;
    grantCycleId: string;
    organizationName: string;
    organizationType: OrganizationType;
  };
  occurredAt: Date;
  grantCycleId: string;
  correlationId: string;
  causationId: string | null;
  actorId: string;
  actorType: 'PUBLIC_APPLICANT';
}

export interface ApplicationSubmittedEvent {
  eventType: 'APPLICATION_SUBMITTED';
  aggregateId: ApplicationId;
  aggregateType: 'APPLICATION';
  eventData: {
    requestedAmountCents: string;
    matchCommitmentCents: string;
    sectionsCompleted: ApplicationSection[];
  };
  occurredAt: Date;
  grantCycleId: string;
  correlationId: string;
  causationId: string;
  actorId: string;
  actorType: 'PUBLIC_APPLICANT';
}

export interface ApplicationEvidenceAttachedEvent {
  eventType: 'APPLICATION_EVIDENCE_ATTACHED';
  aggregateId: ApplicationId;
  aggregateType: 'APPLICATION';
  eventData: {
    evidenceRefId: EvidenceRefId;
    evidenceType: EvidenceType;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    sha256: string;
    storageKey: string;
  };
  occurredAt: Date;
  grantCycleId: string;
  correlationId: string;
  causationId: string;
  actorId: string;
  actorType: 'PUBLIC_APPLICANT';
}

export interface ApplicationScoredEvent {
  eventType: 'APPLICATION_SCORED';
  aggregateId: ApplicationId;
  aggregateType: 'APPLICATION';
  eventData: {
    priorityScore: number;
    scoringBasis: Record<string, any>; // Policy snapshot reference, etc.
  };
  occurredAt: Date;
  grantCycleId: string;
  correlationId: string;
  causationId: string;
  actorId: string;
  actorType: 'ADMIN';
}

export interface ApplicationAwardedEvent {
  eventType: 'APPLICATION_AWARDED';
  aggregateId: ApplicationId;
  aggregateType: 'APPLICATION';
  eventData: {
    grantId: string; // Links to grant creation
    awardedAmountCents: string;
    matchLevel: string;
    decisionBasis: {
      ruleId: string;
      policyVersion: string;
      policySnapshotId: string;
      evidenceRefs: string[];
    };
  };
  occurredAt: Date;
  grantCycleId: string;
  correlationId: string;
  causationId: string;
  actorId: string;
  actorType: 'ADMIN';
}

export interface ApplicationDeniedEvent {
  eventType: 'APPLICATION_DENIED';
  aggregateId: ApplicationId;
  aggregateType: 'APPLICATION';
  eventData: {
    decisionBasis: {
      ruleId: string;
      policyVersion: string;
      policySnapshotId: string;
      evidenceRefs: string[];
    };
  };
  occurredAt: Date;
  grantCycleId: string;
  correlationId: string;
  causationId: string;
  actorId: string;
  actorType: 'ADMIN';
}

export interface FraudSignalDetectedEvent {
  eventType: 'FRAUD_SIGNAL_DETECTED';
  aggregateId: ApplicationId;
  aggregateType: 'APPLICATION';
  eventData: {
    signalId: string;
    signalCode: string;
    severity: FraudSeverity;
    evidence: Record<string, any>;
    recommendedAction: string;
  };
  occurredAt: Date;
  grantCycleId: string;
  correlationId: string;
  causationId: string;
  actorId: string;
  actorType: 'SYSTEM'; // Fraud detection is automated
}

// Union type for all application events
export type ApplicationEvent =
  | ApplicationStartedEvent
  | ApplicationSubmittedEvent
  | ApplicationEvidenceAttachedEvent
  | ApplicationScoredEvent
  | ApplicationAwardedEvent
  | ApplicationDeniedEvent
  | FraudSignalDetectedEvent;
