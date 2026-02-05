/**
 * WVSNP-GMS DOMAIN PRIMITIVES (v5.0 Final)
 * Source: WVSNP_MASTER_SPEC_v5.0.md
 */

import * as crypto from 'crypto';

// === BRANDED TYPES ===
export type MoneyCents = bigint & { readonly brand: 'MoneyCents' };
export type EventId = string & { readonly brand: 'EventId' };
export type ApplicationId = string & { readonly brand: 'ApplicationId' };
export type GrantId = string & { readonly brand: 'GrantId' };
export type VoucherId = string & { readonly brand: 'VoucherId' };
export type ActorId = string & { readonly brand: 'ActorId' };
export type ClaimId = string & { readonly brand: 'ClaimId' };
export type ClaimFingerprint = string & { readonly brand: 'ClaimFingerprint' };
export type AllocatorId = string & { readonly brand: 'AllocatorId' };
export type ArtifactId = string & { readonly brand: 'ArtifactId' };  // HAZARD 6: Branded artifact IDs

// === JSON ENCODING TYPES ===
export type MoneyCentsJSON = string;

// === MONEY FACTORY ===
export const Money = {
  fromBigInt: (value: bigint): MoneyCents => {
    if (value < 0n) {
      throw new Error('NEGATIVE_MONEY_FORBIDDEN');
    }
    return value as MoneyCents;
  },

  fromString: (input: string): MoneyCents => {
    const s = input.trim();

    if (/^(0|[1-9]\d*)$/.test(s)) {
      return Money.fromBigInt(BigInt(s));
    }

    const match = /^(\d+)\.(\d{2})$/.exec(s);
    if (match) {
      const dollars = BigInt(match[1]);
      const cents = BigInt(match[2]);
      return Money.fromBigInt(dollars * 100n + cents);
    }

    throw new Error(`MONEY_FORMAT_INVALID: "${s}"`);
  },

  toJSON: (cents: MoneyCents): MoneyCentsJSON => {
    return cents.toString(10);
  },

  fromJSON: (json: MoneyCentsJSON): MoneyCents => {
    if (!/^(0|[1-9]\d*)$/.test(json)) {
      throw new Error(`MONEY_CENTS_JSON_INVALID: "${json}"`);
    }
    return Money.fromBigInt(BigInt(json));
  },

  format: (cents: MoneyCents): string => {
    const isNegative = cents < 0n;
    const absCents = isNegative ? -cents : cents;

    const dollars = absCents / 100n;
    const remainderCents = absCents % 100n;

    const dollarsStr = dollars.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    const centsStr = remainderCents.toString().padStart(2, '0');

    return `${isNegative ? '-' : ''}$${dollarsStr}.${centsStr}`;
  },

  ZERO: 0n as MoneyCents,
};

// === REIMBURSEMENT RATE ENGINE ===
export interface ReimbursementRate {
  numeratorCents: MoneyCents;
  denominatorCents: MoneyCents;
}

export const RateEngine = {
  create: (grantAward: MoneyCents, matchCommitment: MoneyCents): ReimbursementRate => {
    const total = Money.fromBigInt(grantAward + matchCommitment);
    if (total === 0n) {
      throw new Error('ZERO_PROJECT_TOTAL');
    }
    return {
      numeratorCents: grantAward,
      denominatorCents: total,
    };
  },

  calculate: (eligibleAmount: MoneyCents, rate: ReimbursementRate): MoneyCents => {
    const { numeratorCents, denominatorCents } = rate;
    const halfDenom = denominatorCents / 2n;

    const result = (eligibleAmount * numeratorCents + halfDenom) / denominatorCents;

    return Money.fromBigInt(result);
  },

  toJSON: (rate: ReimbursementRate): { numerator: string; denominator: string } => ({
    numerator: Money.toJSON(rate.numeratorCents),
    denominator: Money.toJSON(rate.denominatorCents),
  }),

  fromJSON: (json: { numerator: string; denominator: string }): ReimbursementRate => ({
    numeratorCents: Money.fromJSON(json.numerator),
    denominatorCents: Money.fromJSON(json.denominator),
  }),
};

// === DETERMINISTIC ID CREATION ===
export const Claim = {
  createId: (): ClaimId => {
    return crypto.randomUUID() as ClaimId;
  },

  /**
   * HAZARD 1 FIX: Canonicalized fingerprint input
   * 
   * Canonicalization rules:
   * - voucherId: lowercase UUID string
   * - clinicId: lowercase UUID string
   * - procedureCode: uppercase, trimmed
   * - dateOfService: ISO YYYY-MM-DD only (no timezone)
   * - rabiesIncluded: explicit 0/1 (not optional)
   * 
   * This prevents false negatives from formatting variations.
   */
  createFingerprint(
    voucherId: VoucherId,
    clinicId: string,
    procedureCode: string,
    dateOfService: string,
    rabiesIncluded: boolean = false
  ): ClaimFingerprint {
    // Canonicalize inputs
    const canonicalVoucherId = voucherId.toLowerCase().trim();
    const canonicalClinicId = clinicId.toLowerCase().trim();
    const canonicalProcedureCode = procedureCode.toUpperCase().trim();
    
    // Ensure dateOfService is YYYY-MM-DD only
    const dateMatch = /^(\d{4}-\d{2}-\d{2})/.exec(dateOfService);
    if (!dateMatch) {
      throw new Error(`INVALID_DATE_FORMAT: ${dateOfService} (expected YYYY-MM-DD)`);
    }
    const canonicalDateOfService = dateMatch[1];
    
    // Explicit boolean as 0/1
    const canonicalRabiesIncluded = rabiesIncluded ? '1' : '0';
    
    // Single canonical format (FORBIDDEN to concatenate elsewhere)
    const input = `${canonicalVoucherId}:${canonicalClinicId}:${canonicalProcedureCode}:${canonicalDateOfService}:rabies=${canonicalRabiesIncluded}`;
    const hash = crypto.createHash('sha256').update(input, 'utf8').digest('hex');
    return hash as ClaimFingerprint;
  },
};

export const Allocator = {
  createId: (grantCycleId: string, countyCode: string): AllocatorId => {
    const hash = crypto.createHash('sha256')
      .update(`VoucherCodeAllocator:${grantCycleId}:${countyCode}`, 'utf8')
      .digest('hex');
    const uuid = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
    return uuid as AllocatorId;
  },
};
