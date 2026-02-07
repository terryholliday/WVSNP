import { MoneyCents } from '../../domain-types';
import { Money } from '../../domain-types';
import {
  StartApplicationCommand,
  SubmitApplicationCommand,
  AttachEvidenceCommand,
  ApplicationSection,
  EvidenceType,
  OrganizationType,
  ApplicationId,
  GranteeId,
  EvidenceRefId
} from './application-types';

/**
 * Validates StartApplicationCommand
 */
export function validateStartApplicationCommand(command: StartApplicationCommand): void {
  // Required fields
  if (!command.commandId) {
    throw new Error('VALIDATION_ERROR: commandId is required');
  }

  if (!command.applicationId) {
    throw new Error('VALIDATION_ERROR: applicationId is required');
  }

  if (!command.granteeId) {
    throw new Error('VALIDATION_ERROR: granteeId is required');
  }

  if (!command.grantCycleId) {
    throw new Error('VALIDATION_ERROR: grantCycleId is required');
  }

  if (!command.organizationName || command.organizationName.trim().length === 0) {
    throw new Error('VALIDATION_ERROR: organizationName is required and cannot be empty');
  }

  if (!command.orgId) {
    throw new Error('VALIDATION_ERROR: orgId is required');
  }

  if (!command.actorId) {
    throw new Error('VALIDATION_ERROR: actorId is required');
  }

  if (!command.correlationId) {
    throw new Error('VALIDATION_ERROR: correlationId is required');
  }

  if (!command.occurredAt) {
    throw new Error('VALIDATION_ERROR: occurredAt is required');
  }

  // Business rule validations
  validateGrantCycleId(command.grantCycleId);
  validateOrganizationType(command.organizationType);
  validateOrganizationName(command.organizationName);

  // Context validations
  validateActorContext(command.orgId, command.actorId);
}

/**
 * Validates SubmitApplicationCommand
 */
export function validateSubmitApplicationCommand(command: SubmitApplicationCommand): void {
  // Required fields
  if (!command.commandId) {
    throw new Error('VALIDATION_ERROR: commandId is required');
  }

  if (!command.applicationId) {
    throw new Error('VALIDATION_ERROR: applicationId is required');
  }

  if (command.requestedAmountCents < 0n) {
    throw new Error('VALIDATION_ERROR: requestedAmountCents cannot be negative');
  }

  if (command.matchCommitmentCents < 0n) {
    throw new Error('VALIDATION_ERROR: matchCommitmentCents cannot be negative');
  }

  if (!command.orgId) {
    throw new Error('VALIDATION_ERROR: orgId is required');
  }

  if (!command.actorId) {
    throw new Error('VALIDATION_ERROR: actorId is required');
  }

  if (!command.correlationId) {
    throw new Error('VALIDATION_ERROR: correlationId is required');
  }

  if (!command.causationId) {
    throw new Error('VALIDATION_ERROR: causationId is required for submission');
  }

  if (!command.occurredAt) {
    throw new Error('VALIDATION_ERROR: occurredAt is required');
  }

  // Business rule validations
  validateFinancialRequest(command.requestedAmountCents, command.matchCommitmentCents);
  validateSectionsCompleted(command.sectionsCompleted);

  // Context validations
  validateActorContext(command.orgId, command.actorId);
}

/**
 * Validates AttachEvidenceCommand
 */
export function validateAttachEvidenceCommand(command: AttachEvidenceCommand): void {
  // Required fields
  if (!command.commandId) {
    throw new Error('VALIDATION_ERROR: commandId is required');
  }

  if (!command.applicationId) {
    throw new Error('VALIDATION_ERROR: applicationId is required');
  }

  if (!command.evidenceRefId) {
    throw new Error('VALIDATION_ERROR: evidenceRefId is required');
  }

  if (!command.fileName || command.fileName.trim().length === 0) {
    throw new Error('VALIDATION_ERROR: fileName is required');
  }

  if (!command.mimeType) {
    throw new Error('VALIDATION_ERROR: mimeType is required');
  }

  if (command.sizeBytes <= 0) {
    throw new Error('VALIDATION_ERROR: sizeBytes must be positive');
  }

  if (!command.sha256 || command.sha256.length !== 64) {
    throw new Error('VALIDATION_ERROR: sha256 must be a valid 64-character hex string');
  }

  if (!command.storageKey) {
    throw new Error('VALIDATION_ERROR: storageKey is required');
  }

  if (!command.orgId) {
    throw new Error('VALIDATION_ERROR: orgId is required');
  }

  if (!command.actorId) {
    throw new Error('VALIDATION_ERROR: actorId is required');
  }

  if (!command.correlationId) {
    throw new Error('VALIDATION_ERROR: correlationId is required');
  }

  if (!command.occurredAt) {
    throw new Error('VALIDATION_ERROR: occurredAt is required');
  }

  // Business rule validations
  validateEvidenceType(command.evidenceType);
  validateFileName(command.fileName);
  validateMimeType(command.mimeType);
  validateFileSize(command.sizeBytes);
  validateSha256(command.sha256);

  // Context validations
  validateActorContext(command.orgId, command.actorId);
}

/**
 * Business rule validations
 */
function validateGrantCycleId(grantCycleId: string): void {
  const grantCyclePattern = /^FY\d{4}$/;
  if (!grantCyclePattern.test(grantCycleId)) {
    throw new Error('VALIDATION_ERROR: grantCycleId must be in format FY#### (e.g., FY2026)');
  }

  const year = parseInt(grantCycleId.substring(2));
  const currentYear = new Date().getFullYear();
  if (year < currentYear - 1 || year > currentYear + 5) {
    throw new Error('VALIDATION_ERROR: grantCycleId year is not reasonable');
  }
}

function validateOrganizationType(type: OrganizationType): void {
  const validTypes: OrganizationType[] = [
    'MUNICIPAL_SHELTER',
    'NONPROFIT_RESCUE',
    'VETERINARY_CLINIC',
    'HUMANE_SOCIETY',
    'ANIMAL_CONTROL',
    'OTHER'
  ];

  if (!validTypes.includes(type)) {
    throw new Error(`VALIDATION_ERROR: organizationType must be one of: ${validTypes.join(', ')}`);
  }
}

function validateOrganizationName(name: string): void {
  if (name.length < 2) {
    throw new Error('VALIDATION_ERROR: organizationName must be at least 2 characters');
  }

  if (name.length > 200) {
    throw new Error('VALIDATION_ERROR: organizationName cannot exceed 200 characters');
  }

  // Basic sanitization - no control characters
  if (/[\x00-\x1F\x7F-\x9F]/.test(name)) {
    throw new Error('VALIDATION_ERROR: organizationName contains invalid characters');
  }
}

function validateFinancialRequest(requested: MoneyCents, committed: MoneyCents): void {
  const maxRequest = Money.fromBigInt(10000000n); // $100,000 max
  if (requested > maxRequest) {
    throw new Error('VALIDATION_ERROR: requestedAmountCents cannot exceed $100,000');
  }

  if (committed > requested) {
    throw new Error('VALIDATION_ERROR: matchCommitmentCents cannot exceed requestedAmountCents');
  }

  const minRequest = Money.fromBigInt(10000n); // $100 min
  if (requested < minRequest) {
    throw new Error('VALIDATION_ERROR: requestedAmountCents must be at least $100');
  }
}

function validateSectionsCompleted(sections: ApplicationSection[]): void {
  const requiredSections: ApplicationSection[] = [
    'ORGANIZATION_INFO',
    'SERVICE_AREA',
    'FINANCIAL_REQUEST',
    'CAPACITY_PLAN',
    'EVIDENCE_UPLOAD',
    'CERTIFICATION'
  ];

  const missingSections = requiredSections.filter(section => !sections.includes(section));
  if (missingSections.length > 0) {
    throw new Error(`VALIDATION_ERROR: Missing required sections: ${missingSections.join(', ')}`);
  }

  // Check for duplicates
  const uniqueSections = [...new Set(sections)];
  if (uniqueSections.length !== sections.length) {
    throw new Error('VALIDATION_ERROR: Duplicate sections in sectionsCompleted');
  }
}

function validateEvidenceType(type: EvidenceType): void {
  const validTypes: EvidenceType[] = [
    'RESIDENCY_PROOF',
    'INCOME_VERIFICATION',
    'LICENSE_DOCUMENTATION',
    'SERVICE_AREA_MAP',
    'CAPACITY_DOCUMENTATION',
    'FINANCIAL_STATEMENT',
    'OTHER'
  ];

  if (!validTypes.includes(type)) {
    throw new Error(`VALIDATION_ERROR: evidenceType must be one of: ${validTypes.join(', ')}`);
  }
}

function validateFileName(fileName: string): void {
  if (fileName.length < 1) {
    throw new Error('VALIDATION_ERROR: fileName cannot be empty');
  }

  if (fileName.length > 255) {
    throw new Error('VALIDATION_ERROR: fileName cannot exceed 255 characters');
  }

  // Basic path traversal protection
  if (fileName.includes('..') || fileName.includes('/') || fileName.includes('\\')) {
    throw new Error('VALIDATION_ERROR: fileName contains invalid path characters');
  }

  // No control characters
  if (/[\x00-\x1F\x7F-\x9F]/.test(fileName)) {
    throw new Error('VALIDATION_ERROR: fileName contains invalid characters');
  }
}

function validateMimeType(mimeType: string): void {
  const allowedTypes = [
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/gif',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain'
  ];

  if (!allowedTypes.includes(mimeType.toLowerCase())) {
    throw new Error(`VALIDATION_ERROR: mimeType ${mimeType} is not allowed`);
  }
}

function validateFileSize(sizeBytes: number): void {
  const maxSize = 10 * 1024 * 1024; // 10MB
  if (sizeBytes > maxSize) {
    throw new Error('VALIDATION_ERROR: file size cannot exceed 10MB');
  }

  const minSize = 100; // 100 bytes
  if (sizeBytes < minSize) {
    throw new Error('VALIDATION_ERROR: file size must be at least 100 bytes');
  }
}

function validateSha256(sha256: string): void {
  if (!/^[a-f0-9]{64}$/i.test(sha256)) {
    throw new Error('VALIDATION_ERROR: sha256 must be a valid 64-character hexadecimal string');
  }
}

function validateActorContext(orgId: string, actorId: string): void {
  // Basic UUID validation
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  if (!uuidPattern.test(orgId)) {
    throw new Error('VALIDATION_ERROR: orgId must be a valid UUID');
  }

  if (!uuidPattern.test(actorId)) {
    throw new Error('VALIDATION_ERROR: actorId must be a valid UUID');
  }
}
