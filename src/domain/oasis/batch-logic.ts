import { MoneyCents, Money } from '../../domain-types';

export type ExportBatchId = string & { readonly brand: 'ExportBatchId' };
export type OasisRefId = string & { readonly brand: 'OasisRefId' };
export type BatchFingerprint = string & { readonly brand: 'BatchFingerprint' };

export type BatchStatus = 
  | 'CREATED'
  | 'FILE_RENDERED'
  | 'SUBMITTED'
  | 'ACKNOWLEDGED'
  | 'REJECTED'
  | 'VOIDED';

export interface BatchState {
  exportBatchId: ExportBatchId;
  grantCycleId: string;
  batchCode: string;
  batchFingerprint: BatchFingerprint;
  periodStart: Date;
  periodEnd: Date;
  watermarkIngestedAt: Date;
  watermarkEventId: string;
  status: BatchStatus;
  recordCount: number;
  controlTotalCents: MoneyCents;
  artifactId: string | null;
  fileSha256: string | null;
  formatVersion: string | null;
  submittedAt: Date | null;
  submissionMethod: string | null;
  oasisRefId: OasisRefId | null;
  acknowledgedAt: Date | null;
  rejectionReason: string | null;
  rejectionCode: string | null;
  voidedReason: string | null;
  voidedByActorId: string | null;
}

export function createInitialBatchState(
  exportBatchId: ExportBatchId,
  grantCycleId: string,
  batchCode: string,
  batchFingerprint: BatchFingerprint,
  periodStart: Date,
  periodEnd: Date,
  watermarkIngestedAt: Date,
  watermarkEventId: string
): BatchState {
  return {
    exportBatchId,
    grantCycleId,
    batchCode,
    batchFingerprint,
    periodStart,
    periodEnd,
    watermarkIngestedAt,
    watermarkEventId,
    status: 'CREATED',
    recordCount: 0,
    controlTotalCents: Money.fromBigInt(0n),
    artifactId: null,
    fileSha256: null,
    formatVersion: null,
    submittedAt: null,
    submissionMethod: null,
    oasisRefId: null,
    acknowledgedAt: null,
    rejectionReason: null,
    rejectionCode: null,
    voidedReason: null,
    voidedByActorId: null,
  };
}

export function applyBatchEvent(state: BatchState, event: any): void {
  const { eventType, eventData, ingestedAt } = event;

  if (eventType === 'OASIS_EXPORT_BATCH_CREATED') {
    // Initial state already set
  }

  if (eventType === 'OASIS_EXPORT_BATCH_ITEM_ADDED') {
    state.recordCount += 1;
    const amountCents = Money.fromJSON(eventData.amountCents as string);
    state.controlTotalCents = Money.fromBigInt(state.controlTotalCents + amountCents);
  }

  if (eventType === 'OASIS_EXPORT_FILE_RENDERED') {
    state.status = 'FILE_RENDERED';
    state.artifactId = eventData.artifactId as string;
    state.fileSha256 = eventData.sha256 as string;
    state.formatVersion = eventData.formatVersion as string;
    state.recordCount = eventData.recordCount as number;
    state.controlTotalCents = Money.fromJSON(eventData.controlTotalCents as string);
  }

  if (eventType === 'OASIS_EXPORT_BATCH_SUBMITTED') {
    state.status = 'SUBMITTED';
    state.submittedAt = ingestedAt;
    state.submissionMethod = eventData.submissionMethod as string;
  }

  if (eventType === 'OASIS_EXPORT_BATCH_ACKNOWLEDGED') {
    state.status = 'ACKNOWLEDGED';
    state.oasisRefId = eventData.oasisRefId as OasisRefId;
    state.acknowledgedAt = new Date(eventData.acceptedAt as string);
  }

  if (eventType === 'OASIS_EXPORT_BATCH_REJECTED') {
    state.status = 'REJECTED';
    state.rejectionReason = eventData.rejectionReason as string;
    state.rejectionCode = eventData.rejectionCode as string | undefined || null;
  }

  if (eventType === 'OASIS_EXPORT_BATCH_VOIDED') {
    state.status = 'VOIDED';
    state.voidedReason = eventData.reason as string;
    state.voidedByActorId = eventData.voidedByActorId as string;
  }
}

export function checkBatchInvariant(state: BatchState): void {
  if (state.status === 'FILE_RENDERED' || state.status === 'SUBMITTED' || state.status === 'ACKNOWLEDGED') {
    if (!state.artifactId) {
      throw new Error('BATCH_INVARIANT: FILE_RENDERED requires artifactId');
    }
    if (!state.fileSha256) {
      throw new Error('BATCH_INVARIANT: FILE_RENDERED requires fileSha256');
    }
    if (!state.formatVersion) {
      throw new Error('BATCH_INVARIANT: FILE_RENDERED requires formatVersion');
    }
  }

  if (state.status === 'ACKNOWLEDGED' && !state.oasisRefId) {
    throw new Error('BATCH_INVARIANT: ACKNOWLEDGED requires oasisRefId');
  }

  if (state.status === 'REJECTED' && !state.rejectionReason) {
    throw new Error('BATCH_INVARIANT: REJECTED requires rejectionReason');
  }

  if (state.status === 'VOIDED' && !state.voidedReason) {
    throw new Error('BATCH_INVARIANT: VOIDED requires voidedReason');
  }
}

export function canSubmitBatch(state: BatchState): { allowed: boolean; reason?: string } {
  if (state.status !== 'FILE_RENDERED') {
    return { allowed: false, reason: 'BATCH_NOT_RENDERED' };
  }
  return { allowed: true };
}

export function canVoidBatch(state: BatchState): { allowed: boolean; reason?: string } {
  if (state.status === 'SUBMITTED' || state.status === 'ACKNOWLEDGED') {
    return { allowed: false, reason: 'BATCH_ALREADY_SUBMITTED' };
  }
  if (state.status === 'VOIDED') {
    return { allowed: false, reason: 'BATCH_ALREADY_VOIDED' };
  }
  if (state.status === 'REJECTED') {
    return { allowed: false, reason: 'BATCH_ALREADY_REJECTED' };
  }
  return { allowed: true };
}

/**
 * Create deterministic batch fingerprint for de-duplication
 * Pattern: SHA-256(grantCycleId + ":" + periodStart + ":" + periodEnd + ":" + sorted(invoiceIds).join(","))
 */
export function createBatchFingerprint(
  grantCycleId: string,
  periodStart: string,
  periodEnd: string,
  invoiceIds: string[]
): BatchFingerprint {
  const crypto = require('crypto');
  const sortedIds = [...invoiceIds].sort();
  const input = `${grantCycleId}:${periodStart}:${periodEnd}:${sortedIds.join(',')}`;
  const hash = crypto.createHash('sha256').update(input, 'utf8').digest('hex');
  return hash as BatchFingerprint;
}
