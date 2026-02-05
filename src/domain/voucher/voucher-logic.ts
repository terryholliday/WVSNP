import { MoneyCents, Money } from '../../domain-types';

export type VoucherStatus = 'TENTATIVE' | 'ISSUED' | 'REDEEMED' | 'EXPIRED' | 'VOIDED';

export interface VoucherState {
  voucherId: string;
  grantId: string;
  voucherCode: string | null;
  status: VoucherStatus;
  maxReimbursementCents: MoneyCents;
  isLIRP: boolean;
  tentativeExpiresAt: Date | null;
  expiresAt: Date | null;
  issuedAt: Date | null;
  redeemedAt: Date | null;
  expiredAt: Date | null;
  voidedAt: Date | null;
}

export function createInitialVoucherState(voucherId: string, grantId: string): VoucherState {
  return {
    voucherId,
    grantId,
    voucherCode: null,
    status: 'TENTATIVE',
    maxReimbursementCents: Money.fromBigInt(0n),
    isLIRP: false,
    tentativeExpiresAt: null,
    expiresAt: null,
    issuedAt: null,
    redeemedAt: null,
    expiredAt: null,
    voidedAt: null,
  };
}

export function applyVoucherEvent(state: VoucherState, event: any): void {
  const { eventType, eventData, ingestedAt } = event;

  if (eventType === 'VOUCHER_ISSUED_TENTATIVE') {
    const maxReimbursementCents = Money.fromJSON(eventData.maxReimbursementCents as string);
    state.maxReimbursementCents = maxReimbursementCents;
    state.tentativeExpiresAt = new Date(eventData.tentativeExpiresAt as string);
    state.expiresAt = state.tentativeExpiresAt;
    // status already TENTATIVE
  }

  if (eventType === 'VOUCHER_ISSUED') {
    state.voucherCode = eventData.voucherCode as string;
    state.status = 'ISSUED';
    state.maxReimbursementCents = Money.fromJSON(eventData.maxReimbursementCents as string);
    state.isLIRP = eventData.isLIRP as boolean;
    state.expiresAt = new Date(eventData.expiresAt as string);
    state.issuedAt = ingestedAt;
    state.tentativeExpiresAt = null;
  }

  if (eventType === 'VOUCHER_ISSUED_CONFIRMED') {
    state.voucherCode = eventData.voucherCode as string;
    if (state.status !== 'TENTATIVE') throw new Error('VOUCHER_NOT_TENTATIVE');
    state.status = 'ISSUED';
    state.issuedAt = new Date(eventData.confirmedAt as string);
    if (eventData.expiresAt) {
      state.expiresAt = new Date(eventData.expiresAt as string);
    }
    state.tentativeExpiresAt = null;
  }

  if (eventType === 'VOUCHER_ISSUED_REJECTED') {
    if (state.status !== 'TENTATIVE') throw new Error('VOUCHER_NOT_TENTATIVE');
    state.status = 'VOIDED'; // or keep as TENTATIVE but rejected?
    // Assuming VOIDED for rejected
    state.voidedAt = ingestedAt;
  }

  if (eventType === 'VOUCHER_REDEEMED') {
    if (state.status !== 'ISSUED') throw new Error('VOUCHER_NOT_ISSUED');
    state.status = 'REDEEMED';
    state.redeemedAt = ingestedAt;
  }

  if (eventType === 'VOUCHER_EXPIRED') {
    if (state.status !== 'ISSUED') throw new Error('VOUCHER_NOT_ISSUED');
    state.status = 'EXPIRED';
    state.expiredAt = ingestedAt;
  }

  if (eventType === 'VOUCHER_VOIDED') {
    state.status = 'VOIDED';
    state.voidedAt = ingestedAt;
  }

  // Add VOUCHER_AMENDED if needed
}

export function checkVoucherInvariant(state: VoucherState): void {
  if (state.status === 'ISSUED' && !state.voucherCode) {
    throw new Error('ISSUED_WITHOUT_CODE');
  }
  if (state.status === 'REDEEMED' && !state.issuedAt) {
    throw new Error('REDEEMED_WITHOUT_ISSUED');
  }
  // Other checks
}
