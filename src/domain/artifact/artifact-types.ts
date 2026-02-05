/**
 * HAZARD 6: Artifact Provenance and Typed IDs
 * 
 * Artifacts must be properly typed with provenance metadata.
 * No primitive string IDs allowed.
 */

import { ArtifactId } from '../../domain-types';

export type ArtifactType = 
  | 'PROCEDURE_REPORT'
  | 'CLINIC_INVOICE'
  | 'RABIES_CERTIFICATE'
  | 'COPAY_RECEIPT'
  | 'ADDITIONAL_DOCUMENT';

export type QuarantineStatus = 'CLEAN' | 'QUARANTINED' | 'PENDING_SCAN';

export interface ArtifactMetadata {
  artifactId: ArtifactId;
  artifactType: ArtifactType;
  sha256: string;
  contentLength: number;
  mimeType: string;
  ingestedAt: Date;
  quarantineStatus: QuarantineStatus;
  uploadedBy: string;
  originalFilename: string;
}

export interface ClaimArtifacts {
  procedureReportId: ArtifactId;
  clinicInvoiceId: ArtifactId;
  rabiesCertificateId?: ArtifactId;
  coPayReceiptId?: ArtifactId;
  additionalIds?: ArtifactId[];
}

/**
 * Validate artifact provenance before attaching to claim
 */
export function validateArtifactProvenance(metadata: ArtifactMetadata): { valid: boolean; reason?: string } {
  if (metadata.quarantineStatus === 'QUARANTINED') {
    return { valid: false, reason: 'ARTIFACT_QUARANTINED' };
  }
  if (metadata.quarantineStatus === 'PENDING_SCAN') {
    return { valid: false, reason: 'ARTIFACT_PENDING_SCAN' };
  }
  if (metadata.contentLength === 0) {
    return { valid: false, reason: 'ARTIFACT_EMPTY' };
  }
  if (!metadata.sha256 || metadata.sha256.length !== 64) {
    return { valid: false, reason: 'ARTIFACT_INVALID_HASH' };
  }
  return { valid: true };
}
