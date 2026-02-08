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

export type GrantStatus = 'CREATED' | 'AGREEMENT_SIGNED' | 'ACTIVE' | 'SUSPENDED' | 'CLOSED';

export interface GrantMetadata {
  grantId: string;
  grantCycleId: string;
  applicationId: string | null;
  status: GrantStatus;
  lirpEnabled: boolean;
  lirpMustHonor: boolean;
  agreementSignedAt: Date | null;
  activatedAt: Date | null;
  suspendedAt: Date | null;
  reinstatedAt: Date | null;
  closedAt: Date | null;
}

export type GrantState = Map<'GENERAL' | 'LIRP', BucketState> & { metadata?: GrantMetadata };

export function createInitialGrantState(): GrantState {
  return new Map() as GrantState;
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
        matchingCommittedCents: Money.fromBigInt(0n),
        matchingReportedCents: Money.fromBigInt(0n),
      });
    }

    state.metadata = {
      grantId: eventData.grantId as string || '',
      grantCycleId: eventData.grantCycleId as string || '',
      applicationId: eventData.applicationId as string || null,
      status: 'CREATED',
      lirpEnabled,
      lirpMustHonor: false,
      agreementSignedAt: null,
      activatedAt: null,
      suspendedAt: null,
      reinstatedAt: null,
      closedAt: null,
    };
  }

  if (eventType === 'GRANT_AGREEMENT_SIGNED') {
    if (state.metadata) {
      state.metadata.status = 'AGREEMENT_SIGNED';
      state.metadata.agreementSignedAt = event.ingestedAt || new Date();
    }
  }

  if (eventType === 'GRANT_ACTIVATED') {
    if (state.metadata) {
      state.metadata.status = 'ACTIVE';
      state.metadata.activatedAt = event.ingestedAt || new Date();
    }
  }

  if (eventType === 'GRANT_SUSPENDED') {
    if (state.metadata) {
      state.metadata.status = 'SUSPENDED';
      state.metadata.suspendedAt = event.ingestedAt || new Date();
    }
  }

  if (eventType === 'GRANT_REINSTATED') {
    if (state.metadata) {
      state.metadata.status = 'ACTIVE';
      state.metadata.reinstatedAt = event.ingestedAt || new Date();
    }
  }

  if (eventType === 'GRANT_CLOSED') {
    if (state.metadata) {
      state.metadata.status = 'CLOSED';
      state.metadata.closedAt = event.ingestedAt || new Date();
    }
  }

  if (eventType === 'LIRP_MUST_HONOR_ENFORCED') {
    if (state.metadata) {
      state.metadata.lirpMustHonor = true;
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
