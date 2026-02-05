import { MoneyCents, Money } from '../../domain-types';

export interface BucketState {
  awardedCents: MoneyCents;
  availableCents: MoneyCents;
  encumberedCents: MoneyCents;
  liquidatedCents: MoneyCents;
  releasedCents: MoneyCents;
  rateNumeratorCents: MoneyCents;
  rateDenominatorCents: MoneyCents;
  matchingCommittedCents: MoneyCents;
  matchingReportedCents: MoneyCents;
}

export type GrantState = Map<'GENERAL' | 'LIRP', BucketState>;

export function createInitialGrantState(): GrantState {
  return new Map();
}

export function applyGrantEvent(state: GrantState, event: any): void {
  const { eventType, eventData } = event;

  if (eventType === 'GRANT_CREATED') {
    const awardedAmountCents = Money.fromJSON(eventData.awardedAmountCents as string);
    const matchCommitmentCents = Money.fromJSON(eventData.matchCommitmentCents as string);
    const rateNumeratorCents = Money.fromJSON(eventData.rateNumeratorCents as string);
    const rateDenominatorCents = Money.fromJSON(eventData.rateDenominatorCents as string);
    const lirpEnabled = eventData.lirpEnabled as boolean;
    const lirpAllocationCents = lirpEnabled ? Money.fromJSON(eventData.lirpAllocationCents as string) : Money.fromBigInt(0n);

    // GENERAL bucket
    state.set('GENERAL', {
      awardedCents: awardedAmountCents,
      availableCents: lirpEnabled ? Money.fromBigInt(awardedAmountCents - lirpAllocationCents) : awardedAmountCents,
      encumberedCents: Money.fromBigInt(0n),
      liquidatedCents: Money.fromBigInt(0n),
      releasedCents: Money.fromBigInt(0n),
      rateNumeratorCents,
      rateDenominatorCents,
      matchingCommittedCents: matchCommitmentCents,
      matchingReportedCents: Money.fromBigInt(0n),
    });

    // LIRP bucket if enabled
    if (lirpEnabled) {
      state.set('LIRP', {
        awardedCents: lirpAllocationCents,
        availableCents: lirpAllocationCents,
        encumberedCents: Money.fromBigInt(0n),
        liquidatedCents: Money.fromBigInt(0n),
        releasedCents: Money.fromBigInt(0n),
        rateNumeratorCents,
        rateDenominatorCents,
        matchingCommittedCents: Money.fromBigInt(0n), // LIRP no matching?
        matchingReportedCents: Money.fromBigInt(0n),
      });
    }
  }

  if (eventType === 'GRANT_FUNDS_ENCUMBERED') {
    const amountCents = Money.fromJSON(eventData.amountCents as string);
    const isLIRP = eventData.isLIRP as boolean;
    const bucket = isLIRP ? 'LIRP' : 'GENERAL';
    const b = state.get(bucket);
    if (!b) throw new Error(`BUCKET_MISSING:${bucket}`);
    b.availableCents = Money.fromBigInt(b.availableCents - amountCents);
    b.encumberedCents = Money.fromBigInt(b.encumberedCents + amountCents);
  }

  if (eventType === 'GRANT_FUNDS_RELEASED') {
    const amountCents = Money.fromJSON(eventData.amountCents as string);
    const isLIRP = eventData.isLIRP as boolean;
    const bucket = isLIRP ? 'LIRP' : 'GENERAL';
    const b = state.get(bucket);
    if (!b) throw new Error(`BUCKET_MISSING:${bucket}`);
    b.encumberedCents = Money.fromBigInt(b.encumberedCents - amountCents);
    b.availableCents = Money.fromBigInt(b.availableCents + amountCents);
    b.releasedCents = Money.fromBigInt(b.releasedCents + amountCents);
  }

  if (eventType === 'GRANT_FUNDS_LIQUIDATED') {
    const amountCents = Money.fromJSON(eventData.amountCents as string);
    const isLIRP = eventData.isLIRP as boolean;
    const bucket = isLIRP ? 'LIRP' : 'GENERAL';
    const b = state.get(bucket);
    if (!b) throw new Error(`BUCKET_MISSING:${bucket}`);
    b.encumberedCents = Money.fromBigInt(b.encumberedCents - amountCents);
    b.liquidatedCents = Money.fromBigInt(b.liquidatedCents + amountCents);
  }

  if (eventType === 'MATCHING_FUNDS_REPORTED') {
    const amountCents = Money.fromJSON(eventData.amountCents as string);
    const b = state.get('GENERAL');
    if (!b) throw new Error('GENERAL_BUCKET_MISSING');
    b.matchingReportedCents = Money.fromBigInt(b.matchingReportedCents + amountCents);
  }

  if (eventType === 'MATCHING_FUNDS_ADJUSTED') {
    const amountCents = Money.fromJSON(eventData.amountCents as string);
    const b = state.get('GENERAL');
    if (!b) throw new Error('GENERAL_BUCKET_MISSING');
    b.matchingReportedCents = Money.fromBigInt(b.matchingReportedCents + amountCents);
  }
}

export function checkGrantInvariant(state: GrantState): void {
  for (const [bucket, b] of state) {
    if (b.availableCents + b.encumberedCents + b.liquidatedCents !== b.awardedCents) {
      throw new Error(`GRANT_BALANCE_INVARIANT_VIOLATION:${bucket}`);
    }
    if (b.availableCents < 0n || b.encumberedCents < 0n || b.liquidatedCents < 0n) {
      throw new Error(`NEGATIVE_BALANCE:${bucket}`);
    }
  }
}
