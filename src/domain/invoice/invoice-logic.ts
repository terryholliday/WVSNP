import { MoneyCents, Money } from '../../domain-types';

export type InvoiceStatus = 'DRAFT' | 'SUBMITTED' | 'PAID' | 'PARTIALLY_PAID';

export interface InvoiceState {
  invoiceId: string;
  clinicId: string;
  periodStart: Date;
  periodEnd: Date;
  totalAmountCents: MoneyCents;
  claimIds: string[];
  adjustmentIds: string[];
  status: InvoiceStatus;
  submittedAt: Date | null;
  generatedAt: Date | null;
}

export interface AdjustmentState {
  adjustmentId: string;
  sourceInvoiceId: string;
  targetInvoiceId: string | null;
  amountCents: MoneyCents;
  reason: string | null;
  recordedAt: Date | null;
  appliedAt: Date | null;
}

export function createInitialInvoiceState(
  invoiceId: string,
  clinicId: string,
  periodStart: Date,
  periodEnd: Date
): InvoiceState {
  return {
    invoiceId,
    clinicId,
    periodStart,
    periodEnd,
    totalAmountCents: Money.fromBigInt(0n),
    claimIds: [],
    adjustmentIds: [],
    status: 'DRAFT',
    submittedAt: null,
    generatedAt: null,
  };
}

export function applyInvoiceEvent(state: InvoiceState, event: any): void {
  const { eventType, eventData, ingestedAt } = event;

  if (eventType === 'INVOICE_GENERATED') {
    state.claimIds = eventData.claimIds as string[];
    state.adjustmentIds = eventData.adjustmentIds as string[] || [];
    state.totalAmountCents = Money.fromJSON(eventData.totalAmountCents as string);
    state.generatedAt = ingestedAt;
  }

  if (eventType === 'INVOICE_SUBMITTED') {
    if (state.status !== 'DRAFT') {
      throw new Error('INVOICE_NOT_DRAFT');
    }
    state.status = 'SUBMITTED';
    state.submittedAt = ingestedAt;
    // LAW 2.9: Invoice is LOCKED FOREVER after submission
  }

  // Payment status is PROJECTION-DERIVED, not event-based (LAW 7.6)
  // No INVOICE_STATUS_UPDATED event
}

export function createInitialAdjustmentState(adjustmentId: string, sourceInvoiceId: string): AdjustmentState {
  return {
    adjustmentId,
    sourceInvoiceId,
    targetInvoiceId: null,
    amountCents: Money.fromBigInt(0n),
    reason: null,
    recordedAt: null,
    appliedAt: null,
  };
}

export function applyAdjustmentEvent(state: AdjustmentState, event: any): void {
  const { eventType, eventData, ingestedAt } = event;

  if (eventType === 'INVOICE_ADJUSTMENT_CREATED') {
    state.amountCents = Money.fromJSON(eventData.amountCents as string);
    state.reason = eventData.reason as string;
    state.recordedAt = ingestedAt;
  }

  if (eventType === 'INVOICE_ADJUSTMENT_APPLIED') {
    state.targetInvoiceId = eventData.targetInvoiceId as string;
    state.appliedAt = ingestedAt;
  }
}

export function checkInvoiceInvariant(state: InvoiceState): void {
  if (state.status === 'SUBMITTED' && !state.submittedAt) {
    throw new Error('SUBMITTED_WITHOUT_TIMESTAMP');
  }
  if (state.status === 'SUBMITTED' && state.claimIds.length === 0 && state.adjustmentIds.length === 0) {
    throw new Error('SUBMITTED_EMPTY_INVOICE');
  }
  if (state.totalAmountCents < 0n) {
    throw new Error('NEGATIVE_INVOICE_TOTAL');
  }
}

export function computeInvoiceStatus(
  totalAmountCents: MoneyCents,
  paidAmountCents: MoneyCents,
  isSubmitted: boolean
): InvoiceStatus {
  // LAW 7.6: Payment status is PROJECTION-DERIVED
  if (!isSubmitted) {
    return 'DRAFT';
  }
  if (paidAmountCents >= totalAmountCents) {
    return 'PAID';
  }
  if (paidAmountCents > 0n) {
    return 'PARTIALLY_PAID';
  }
  return 'SUBMITTED';
}

export function generateMonthlyInvoicePeriod(year: number, month: number): { start: Date; end: Date } {
  // LAW 7.3: Generated monthly on the 1st for prior month (America/New_York)
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0, 23, 59, 59, 999);
  return { start, end };
}
