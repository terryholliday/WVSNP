/**
 * WVSNP Demo Data Seeder (Phase 4 aligned)
 * - Uses current event types and domain rules
 * - Inserts events, then builds projections from the event log
 * - Works with DATABASE_URL (Supabase/local)
 */

import { config } from 'dotenv';
import { Pool } from 'pg';
import * as crypto from 'crypto';
import { EventStore, DomainEvent } from '../event-store';
import { Money } from '../domain-types';
import { uuidv7 } from '../uuidv7';
import { applyGrantEvent, checkGrantInvariant, createInitialGrantState } from '../domain/grant/grant-logic';
import { applyVoucherEvent, checkVoucherInvariant, createInitialVoucherState } from '../domain/voucher/voucher-logic';
import { applyClaimEvent, checkClaimInvariant, createInitialClaimState } from '../domain/claim/claim-logic';
import { applyInvoiceEvent, checkInvoiceInvariant, computeInvoiceStatus, createInitialInvoiceState, generateMonthlyInvoicePeriod } from '../domain/invoice/invoice-logic';
import { applyClinicEvent, checkClinicInvariant, createInitialClinicState } from '../domain/clinic/clinic-logic';
import { Claim } from '../domain-types';

config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/wvsnp_gms',
});

const store = new EventStore(pool);

let lastTick = Date.now();
let eventsThisTick = 0;

async function throttleUuidv7(): Promise<void> {
  const now = Date.now();
  if (now !== lastTick) {
    lastTick = now;
    eventsThisTick = 0;
    return;
  }
  eventsThisTick += 1;
  if (eventsThisTick >= 3000) {
    await new Promise(resolve => setTimeout(resolve, 1));
    lastTick = Date.now();
    eventsThisTick = 0;
  }
}

const GRANT_CYCLE_ID = crypto.randomUUID();
const PERIOD_START = new Date('2024-07-01T00:00:00Z');
const PERIOD_END = new Date('2025-06-30T23:59:59Z');
const ACTOR_ID = crypto.randomUUID();
const ACTOR_TYPE: 'SYSTEM' = 'SYSTEM';

const COUNTIES = ['KANAWHA', 'BERKELEY', 'CABELL', 'MONONGALIA', 'WOOD', 'RALEIGH'];
const CLINIC_NAMES = [
  'Charleston Animal Hospital',
  'Mountaineer Veterinary Clinic',
  'Blue Ridge Animal Care',
  'Appalachian Pet Hospital',
  'New River Veterinary Services',
  'Kanawha Valley Animal Clinic',
  'Eastern Panhandle Vet Center',
  'Greenbrier Valley Veterinary',
];

type ClinicSeed = { clinicId: string; clinicName: string; oasisVendorCode: string };
type GrantSeed = { grantId: string; county: string; lirpEnabled: boolean };
type VoucherSeed = {
  voucherId: string;
  grantId: string;
  voucherCode: string;
  procedureCode: string;
  isLIRP: boolean;
  amountCents: number;
  issuedAt: Date;
  expiresAt: Date;
};
type ClaimOutcome =
  | 'NONE'
  | 'PENDING'
  | 'DENIED'
  | 'ADJUSTED'
  | 'APPROVED_INVOICE'
  | 'APPROVED_NO_INVOICE'
  | 'APPROVED_ADJUSTED';
type ClaimSeed = {
  claimId: string;
  grantCycleId: string;
  voucherId: string;
  clinicId: string;
  procedureCode: string;
  dateOfService: Date;
  submittedAmountCents: number;
  approvedAmountCents: number | null;
  status: 'SUBMITTED' | 'APPROVED' | 'DENIED' | 'ADJUSTED';
  shouldInvoice: boolean;
};
type InvoiceSeed = {
  invoiceId: string;
  clinicId: string;
  totalCents: number;
};

async function appendEvent(input: {
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  eventData: Record<string, unknown>;
  occurredAt: Date;
  grantCycleId?: string;
  correlationId?: string;
  causationId?: string | null;
}): Promise<DomainEvent> {
  await throttleUuidv7();
  return store.append({
    eventId: EventStore.newEventId(),
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    eventType: input.eventType,
    eventData: input.eventData,
    occurredAt: input.occurredAt,
    grantCycleId: input.grantCycleId ?? GRANT_CYCLE_ID,
    correlationId: input.correlationId ?? crypto.randomUUID(),
    causationId: input.causationId ?? null,
    actorId: ACTOR_ID as any,
    actorType: ACTOR_TYPE,
  });
}

function pick<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pickClaimOutcome(index: number): ClaimOutcome {
  switch (index % 12) {
    case 0:
      return 'NONE';
    case 1:
      return 'PENDING';
    case 2:
      return 'DENIED';
    case 3:
      return 'APPROVED_INVOICE';
    case 4:
      return 'APPROVED_ADJUSTED';
    case 5:
      return 'APPROVED_NO_INVOICE';
    case 6:
      return 'PENDING';
    case 7:
      return 'DENIED';
    case 8:
      return 'ADJUSTED';
    case 9:
      return 'APPROVED_INVOICE';
    case 10:
      return 'APPROVED_NO_INVOICE';
    default:
      return 'APPROVED_INVOICE';
  }
}

function toDateOnly(d: Date): string {
  return d.toISOString().split('T')[0];
}

async function resetIfRequested(): Promise<void> {
  if (process.env.SEED_RESET !== '1') {
    return;
  }
  await pool.query(`
    TRUNCATE
      event_log,
      grant_balances_projection,
      vouchers_projection,
      allocators_projection,
      vet_clinics_projection,
      claims_projection,
      invoices_projection,
      payments_projection,
      invoice_adjustments_projection,
      oasis_export_batches_projection,
      oasis_export_batch_items_projection,
      grant_cycle_closeout_projection,
      idempotency_cache
    CASCADE
  `);
}

async function seedClinics(): Promise<ClinicSeed[]> {
  const clinics: ClinicSeed[] = [];
  let vendorSeq = 1;
  for (const clinicName of CLINIC_NAMES) {
    const clinicId = crypto.randomUUID();
    const oasisVendorCode = `VEND${String(vendorSeq).padStart(3, '0')}`;
    vendorSeq += 1;

    const registeredAt = new Date('2024-06-15T12:00:00Z');
    await appendEvent({
      aggregateType: 'VET_CLINIC',
      aggregateId: clinicId,
      eventType: 'VET_CLINIC_REGISTERED',
      eventData: { clinicName },
      occurredAt: registeredAt,
      grantCycleId: GRANT_CYCLE_ID,
    });

    await appendEvent({
      aggregateType: 'VET_CLINIC',
      aggregateId: clinicId,
      eventType: 'VET_CLINIC_LICENSE_STATUS_RECORDED',
      eventData: {
        licenseStatus: 'VALID',
        licenseNumber: `LIC-${randomBetween(1000, 9999)}`,
        licenseExpiresAt: '2026-12-31',
      },
      occurredAt: registeredAt,
      grantCycleId: GRANT_CYCLE_ID,
    });

    await appendEvent({
      aggregateType: 'VET_CLINIC',
      aggregateId: clinicId,
      eventType: 'VET_CLINIC_OASIS_VENDOR_CODE_ASSIGNED',
      eventData: {
        oasisVendorCode,
      },
      occurredAt: registeredAt,
      grantCycleId: GRANT_CYCLE_ID,
    });

    clinics.push({ clinicId, clinicName, oasisVendorCode });
  }
  return clinics;
}

async function seedGrants(): Promise<GrantSeed[]> {
  const grants: GrantSeed[] = [];
  for (const county of COUNTIES) {
    const grantId = crypto.randomUUID();
    const awardedAmountCents = 40000000;
    const matchCommitmentCents = 10000000;
    const lirpAllocationCents = 0;
    const lirpEnabled = false;

    await appendEvent({
      aggregateType: 'GRANT',
      aggregateId: grantId,
      eventType: 'GRANT_CREATED',
      eventData: {
        grantId,
        grantCycleId: GRANT_CYCLE_ID,
        countyCode: county,
        awardedAmountCents: String(awardedAmountCents),
        matchCommitmentCents: String(matchCommitmentCents),
        rateNumeratorCents: String(awardedAmountCents),
        rateDenominatorCents: String(awardedAmountCents + matchCommitmentCents),
        lirpEnabled,
        lirpAllocationCents: String(lirpAllocationCents),
      },
      occurredAt: PERIOD_START,
      grantCycleId: GRANT_CYCLE_ID,
    });

    grants.push({ grantId, county, lirpEnabled });
  }
  return grants;
}

async function seedVouchers(grants: GrantSeed[]): Promise<VoucherSeed[]> {
  const vouchers: VoucherSeed[] = [];
  let sequence = 1;

  for (const grant of grants) {
    const vouchersPerGrant = 40;
    for (let i = 0; i < vouchersPerGrant; i += 1) {
      const isLIRP = false;
      const procedures = ['DOG_SPAY', 'DOG_NEUTER', 'CAT_SPAY', 'CAT_NEUTER'];
      const procedureCode = pick(procedures);
      let amountCents = 5500;
      if (procedureCode === 'DOG_SPAY') amountCents = 7500;
      if (procedureCode === 'DOG_NEUTER') amountCents = 6500;
      if (procedureCode === 'CAT_SPAY') amountCents = 5500;
      if (procedureCode === 'CAT_NEUTER') amountCents = 4500;
      if (isLIRP) amountCents = Math.min(amountCents, 6000);

      const voucherId = crypto.randomUUID();
      const issueMonthOffset = randomBetween(0, 7);
      const issuedAt = new Date(PERIOD_START);
      issuedAt.setUTCMonth(PERIOD_START.getUTCMonth() + issueMonthOffset);
      issuedAt.setUTCDate(randomBetween(1, 25));
      const expiresAt = new Date(issuedAt);
      expiresAt.setUTCDate(expiresAt.getUTCDate() + 90);

      const dateStr = toDateOnly(issuedAt).replace(/-/g, '');
      const voucherCode = `${grant.county}-${dateStr}-${String(sequence).padStart(4, '0')}`;
      sequence += 1;

      await appendEvent({
        aggregateType: 'VOUCHER',
        aggregateId: voucherId,
        eventType: 'VOUCHER_ISSUED',
        eventData: {
          grantId: grant.grantId,
          voucherCode,
          recipientType: 'OWNER',
          recipientName: 'Demo Recipient',
          animalType: procedureCode.startsWith('DOG') ? 'DOG' : 'CAT',
          procedureType: procedureCode,
          maxReimbursementCents: String(amountCents),
          expiresAt: expiresAt.toISOString(),
          isLIRP,
          coPayRequired: false,
        },
        occurredAt: issuedAt,
        grantCycleId: GRANT_CYCLE_ID,
      });

      await appendEvent({
        aggregateType: 'GRANT',
        aggregateId: grant.grantId,
        eventType: 'GRANT_FUNDS_ENCUMBERED',
        eventData: {
          voucherId,
          amountCents: String(amountCents),
          isLIRP,
        },
        occurredAt: issuedAt,
        grantCycleId: GRANT_CYCLE_ID,
      });

      vouchers.push({
        voucherId,
        grantId: grant.grantId,
        voucherCode,
        procedureCode,
        isLIRP,
        amountCents,
        issuedAt,
        expiresAt,
      });
    }
  }

  return vouchers;
}

async function seedClaims(vouchers: VoucherSeed[], clinics: ClinicSeed[]): Promise<ClaimSeed[]> {
  const claims: ClaimSeed[] = [];
  let claimIndex = 0;
  for (const voucher of vouchers) {
    const outcome = pickClaimOutcome(claimIndex);
    claimIndex += 1;
    if (outcome === 'NONE') {
      continue;
    }
    const clinic = pick(clinics);
    const dateOfService = new Date(voucher.issuedAt);
    dateOfService.setUTCDate(dateOfService.getUTCDate() + randomBetween(5, 55));

    const claimId = crypto.randomUUID();
    const claimFingerprint = Claim.createFingerprint(
      voucher.voucherId as any,
      clinic.clinicId,
      voucher.procedureCode,
      toDateOnly(dateOfService),
      false
    );

    const submittedAt = new Date(dateOfService);
    submittedAt.setUTCDate(submittedAt.getUTCDate() + randomBetween(1, 5));

    await appendEvent({
      aggregateType: 'CLAIM',
      aggregateId: claimId,
      eventType: 'CLAIM_SUBMITTED',
      eventData: {
        claimFingerprint,
        grantCycleId: GRANT_CYCLE_ID,
        voucherId: voucher.voucherId,
        clinicId: clinic.clinicId,
        procedureCode: voucher.procedureCode,
        dateOfService: toDateOnly(dateOfService),
        submittedAmountCents: String(voucher.amountCents),
        artifacts: {
          procedureReportId: crypto.randomUUID(),
          clinicInvoiceId: crypto.randomUUID(),
        },
        licenseCheckEvidence: {
          licenseNumber: 'DEMO-LIC',
          licenseStatus: 'VALID',
          licenseExpiresAt: '2026-12-31',
          licenseEvidenceSource: 'seed',
          licenseCheckedAtOccurred: submittedAt.toISOString(),
          licenseCheckedAtIngested: submittedAt.toISOString(),
          validForDateOfService: true,
        },
      },
      occurredAt: submittedAt,
      grantCycleId: GRANT_CYCLE_ID,
    });

    await appendEvent({
      aggregateType: 'VOUCHER',
      aggregateId: voucher.voucherId,
      eventType: 'VOUCHER_REDEEMED',
      eventData: {
        claimId,
      },
      occurredAt: submittedAt,
      grantCycleId: GRANT_CYCLE_ID,
    });

    let approvedAmountCents: number | null = null;
    let status: ClaimSeed['status'] = 'SUBMITTED';
    let shouldInvoice = false;
    let decisionBase = submittedAt;

    const adjustmentDelta = ((claimIndex % 3) + 1) * 250;
    const adjustedAmountCents = Math.max(2500, voucher.amountCents - adjustmentDelta);

    if (outcome === 'ADJUSTED' || outcome === 'APPROVED_ADJUSTED') {
      const adjustedAt = new Date(submittedAt);
      adjustedAt.setUTCDate(adjustedAt.getUTCDate() + 1);
      await appendEvent({
        aggregateType: 'CLAIM',
        aggregateId: claimId,
        eventType: 'CLAIM_ADJUSTED',
        eventData: {
          newAmountCents: String(adjustedAmountCents),
        },
        occurredAt: adjustedAt,
        grantCycleId: GRANT_CYCLE_ID,
      });
      approvedAmountCents = adjustedAmountCents;
      status = 'ADJUSTED';
      decisionBase = adjustedAt;
    }

    if (
      outcome === 'APPROVED_INVOICE'
      || outcome === 'APPROVED_NO_INVOICE'
      || outcome === 'APPROVED_ADJUSTED'
    ) {
      const decisionAt = new Date(decisionBase);
      decisionAt.setUTCDate(decisionAt.getUTCDate() + randomBetween(2, 6));
      const finalAmount = approvedAmountCents ?? voucher.amountCents;

      await appendEvent({
        aggregateType: 'CLAIM',
        aggregateId: claimId,
        eventType: 'CLAIM_APPROVED',
        eventData: {
          approvedAmountCents: String(finalAmount),
          decisionBasis: {
            policySnapshotId: crypto.randomUUID(),
            decidedBy: ACTOR_ID,
            decidedAt: decisionAt.toISOString(),
            reason: 'Demo approval',
          },
        },
        occurredAt: decisionAt,
        grantCycleId: GRANT_CYCLE_ID,
      });

      await appendEvent({
        aggregateType: 'GRANT',
        aggregateId: voucher.grantId,
        eventType: 'GRANT_FUNDS_LIQUIDATED',
        eventData: {
          claimId,
          amountCents: String(finalAmount),
          isLIRP: voucher.isLIRP,
        },
        occurredAt: decisionAt,
        grantCycleId: GRANT_CYCLE_ID,
      });

      approvedAmountCents = finalAmount;
      status = 'APPROVED';
      shouldInvoice = outcome !== 'APPROVED_NO_INVOICE';
    } else if (outcome === 'DENIED') {
      const decisionAt = new Date(submittedAt);
      decisionAt.setUTCDate(decisionAt.getUTCDate() + randomBetween(2, 6));
      await appendEvent({
        aggregateType: 'CLAIM',
        aggregateId: claimId,
        eventType: 'CLAIM_DENIED',
        eventData: {
          decisionBasis: {
            policySnapshotId: crypto.randomUUID(),
            decidedBy: ACTOR_ID,
            decidedAt: decisionAt.toISOString(),
            reason: 'Demo denial',
          },
        },
        occurredAt: decisionAt,
        grantCycleId: GRANT_CYCLE_ID,
      });
      status = 'DENIED';
    }

    claims.push({
      claimId,
      grantCycleId: GRANT_CYCLE_ID,
      voucherId: voucher.voucherId,
      clinicId: clinic.clinicId,
      procedureCode: voucher.procedureCode,
      dateOfService,
      submittedAmountCents: voucher.amountCents,
      approvedAmountCents,
      status,
      shouldInvoice,
    });
  }
  return claims;
}

async function seedVoucherResolutions(vouchers: VoucherSeed[], claims: ClaimSeed[]): Promise<void> {
  const claimedVoucherIds = new Set(claims.map(claim => claim.voucherId));
  let resolutionIndex = 0;

  for (const voucher of vouchers) {
    if (claimedVoucherIds.has(voucher.voucherId)) {
      continue;
    }

    const resolutionType = resolutionIndex % 4;
    resolutionIndex += 1;

    if (resolutionType === 0) {
      const voidedAt = new Date(voucher.issuedAt);
      voidedAt.setUTCDate(voidedAt.getUTCDate() + randomBetween(7, 25));
      await appendEvent({
        aggregateType: 'VOUCHER',
        aggregateId: voucher.voucherId,
        eventType: 'VOUCHER_VOIDED',
        eventData: {
          reason: 'Seeded void',
        },
        occurredAt: voidedAt,
        grantCycleId: GRANT_CYCLE_ID,
      });
      await appendEvent({
        aggregateType: 'GRANT',
        aggregateId: voucher.grantId,
        eventType: 'GRANT_FUNDS_RELEASED',
        eventData: {
          voucherId: voucher.voucherId,
          amountCents: String(voucher.amountCents),
          isLIRP: voucher.isLIRP,
        },
        occurredAt: voidedAt,
        grantCycleId: GRANT_CYCLE_ID,
      });
    } else if (resolutionType === 1) {
      const expiredAt = new Date(voucher.expiresAt);
      expiredAt.setUTCDate(expiredAt.getUTCDate() + randomBetween(1, 5));
      await appendEvent({
        aggregateType: 'VOUCHER',
        aggregateId: voucher.voucherId,
        eventType: 'VOUCHER_EXPIRED',
        eventData: {},
        occurredAt: expiredAt,
        grantCycleId: GRANT_CYCLE_ID,
      });
      await appendEvent({
        aggregateType: 'GRANT',
        aggregateId: voucher.grantId,
        eventType: 'GRANT_FUNDS_RELEASED',
        eventData: {
          voucherId: voucher.voucherId,
          amountCents: String(voucher.amountCents),
          isLIRP: voucher.isLIRP,
        },
        occurredAt: expiredAt,
        grantCycleId: GRANT_CYCLE_ID,
      });
    }
  }
}

async function seedInvoices(claims: ClaimSeed[]): Promise<InvoiceSeed[]> {
  const invoices: InvoiceSeed[] = [];
  const approvedClaims = claims.filter(c => c.status === 'APPROVED' && c.shouldInvoice);
  const claimsByClinicMonth = new Map<string, ClaimSeed[]>();
  for (const claim of approvedClaims) {
    const key = `${claim.clinicId}:${claim.dateOfService.getUTCFullYear()}-${claim.dateOfService.getUTCMonth() + 1}`;
    if (!claimsByClinicMonth.has(key)) {
      claimsByClinicMonth.set(key, []);
    }
    claimsByClinicMonth.get(key)!.push(claim);
  }

  for (const [key, group] of claimsByClinicMonth) {
    const [clinicId, yearMonth] = key.split(':');
    const [yearStr, monthStr] = (yearMonth || '').split('-');
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10);
    const { start, end } = generateMonthlyInvoicePeriod(year, month);
    const invoiceId = crypto.randomUUID();
    const totalCents = group.reduce((sum, c) => sum + (c.approvedAmountCents ?? c.submittedAmountCents), 0);
    const claimIds = group.map(c => c.claimId);

    const watermarkIngestedAt = new Date();
    const watermarkEventId = crypto.randomUUID();

    const generatedEvent = await appendEvent({
      aggregateType: 'INVOICE',
      aggregateId: invoiceId,
      eventType: 'INVOICE_GENERATED',
      eventData: {
        clinicId,
        periodStart: toDateOnly(start),
        periodEnd: toDateOnly(end),
        watermarkIngestedAt: watermarkIngestedAt.toISOString(),
        watermarkEventId,
        claimIds,
        adjustmentIds: [],
        totalAmountCents: String(totalCents),
      },
      occurredAt: new Date(),
      grantCycleId: GRANT_CYCLE_ID,
    });

    await appendEvent({
      aggregateType: 'INVOICE',
      aggregateId: invoiceId,
      eventType: 'INVOICE_SUBMITTED',
      eventData: {},
      occurredAt: new Date(),
      grantCycleId: GRANT_CYCLE_ID,
      causationId: generatedEvent.eventId,
    });

    for (const claimId of claimIds) {
      await appendEvent({
        aggregateType: 'CLAIM',
        aggregateId: claimId,
        eventType: 'CLAIM_INVOICED',
        eventData: { invoiceId },
        occurredAt: new Date(),
        grantCycleId: GRANT_CYCLE_ID,
        causationId: generatedEvent.eventId,
      });
    }

    invoices.push({ invoiceId, clinicId, totalCents });
  }

  return invoices;
}

async function seedPayments(invoices: InvoiceSeed[]): Promise<string[]> {
  const paymentIds: string[] = [];
  let paymentIndex = 0;

  for (const invoice of invoices) {
    const paymentMode = paymentIndex % 3;
    paymentIndex += 1;

    if (paymentMode === 2) {
      continue;
    }

    const amountCents = paymentMode === 0
      ? invoice.totalCents
      : Math.max(1, Math.floor(invoice.totalCents * 0.4));

    const paymentId = EventStore.newEventId();
    const recordedAt = new Date();

    await appendEvent({
      aggregateType: 'PAYMENT',
      aggregateId: paymentId,
      eventType: 'PAYMENT_RECORDED',
      eventData: {
        invoiceId: invoice.invoiceId,
        amountCents: String(amountCents),
        paymentChannel: 'ACH',
        referenceId: `SEED-${paymentId}`,
      },
      occurredAt: recordedAt,
      grantCycleId: GRANT_CYCLE_ID,
    });

    paymentIds.push(paymentId);
  }

  return paymentIds;
}

async function buildPaymentProjection(paymentId: string): Promise<void> {
  const eventRows = await pool.query(
    `SELECT event_type, event_data, ingested_at, event_id
     FROM event_log
     WHERE aggregate_id = $1 AND aggregate_type = 'PAYMENT'
     ORDER BY ingested_at ASC, event_id ASC`,
    [paymentId]
  );
  if (eventRows.rows.length === 0) return;

  const firstRow = eventRows.rows[0];
  const lastRow = eventRows.rows[eventRows.rows.length - 1];
  const eventData = firstRow.event_data as Record<string, unknown>;

  await pool.query(
    `INSERT INTO payments_projection (
      payment_id, invoice_id, amount_cents, payment_channel, reference_id,
      recorded_at, rebuilt_at, watermark_ingested_at, watermark_event_id
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    ON CONFLICT (payment_id) DO UPDATE SET
      invoice_id = EXCLUDED.invoice_id,
      amount_cents = EXCLUDED.amount_cents,
      payment_channel = EXCLUDED.payment_channel,
      reference_id = EXCLUDED.reference_id,
      recorded_at = EXCLUDED.recorded_at,
      rebuilt_at = EXCLUDED.rebuilt_at,
      watermark_ingested_at = EXCLUDED.watermark_ingested_at,
      watermark_event_id = EXCLUDED.watermark_event_id
    `,
    [
      paymentId,
      eventData.invoiceId as string,
      String(eventData.amountCents ?? '0'),
      (eventData.paymentChannel as string) || 'ACH',
      eventData.referenceId as string | undefined,
      firstRow.ingested_at,
      new Date(),
      lastRow.ingested_at || new Date(),
      lastRow.event_id || uuidv7(),
    ]
  );
}

async function buildClinicProjection(clinicId: string): Promise<void> {
  const eventRows = await pool.query(
    `SELECT event_type, event_data, ingested_at
     FROM event_log
     WHERE aggregate_id = $1 AND aggregate_type = 'VET_CLINIC'
     ORDER BY ingested_at ASC, event_id ASC`,
    [clinicId]
  );
  if (eventRows.rows.length === 0) return;
  const first = eventRows.rows[0].event_data;
  const state = createInitialClinicState(clinicId, first.clinicName as string);
  for (const row of eventRows.rows) {
    applyClinicEvent(state, {
      eventType: row.event_type,
      eventData: row.event_data,
      ingestedAt: row.ingested_at,
    });
  }
  checkClinicInvariant(state);

  await pool.query(
    `INSERT INTO vet_clinics_projection (
      clinic_id, clinic_name, status, license_status, license_number, license_expires_at,
      oasis_vendor_code, payment_info, registered_at, suspended_at, reinstated_at,
      rebuilt_at, watermark_ingested_at, watermark_event_id
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
    ON CONFLICT (clinic_id) DO UPDATE SET
      clinic_name = EXCLUDED.clinic_name,
      status = EXCLUDED.status,
      license_status = EXCLUDED.license_status,
      license_number = EXCLUDED.license_number,
      license_expires_at = EXCLUDED.license_expires_at,
      oasis_vendor_code = EXCLUDED.oasis_vendor_code,
      payment_info = EXCLUDED.payment_info,
      registered_at = EXCLUDED.registered_at,
      suspended_at = EXCLUDED.suspended_at,
      reinstated_at = EXCLUDED.reinstated_at,
      rebuilt_at = EXCLUDED.rebuilt_at,
      watermark_ingested_at = EXCLUDED.watermark_ingested_at,
      watermark_event_id = EXCLUDED.watermark_event_id
    `,
    [
      state.clinicId,
      state.clinicName,
      state.status,
      state.licenseStatus,
      state.licenseNumber,
      state.licenseExpiresAt,
      state.oasisVendorCode,
      state.paymentInfo ? JSON.stringify(state.paymentInfo) : null,
      state.registeredAt,
      state.suspendedAt,
      state.reinstatedAt,
      new Date(),
      eventRows.rows[eventRows.rows.length - 1]?.ingested_at || new Date(),
      eventRows.rows[eventRows.rows.length - 1]?.event_id || uuidv7(),
    ]
  );
}

async function buildGrantProjection(grantId: string): Promise<void> {
  const eventRows = await pool.query(
    `SELECT event_type, event_data, ingested_at, grant_cycle_id, event_id
     FROM event_log
     WHERE aggregate_id = $1 AND aggregate_type = 'GRANT'
     ORDER BY ingested_at ASC, event_id ASC`,
    [grantId]
  );
  if (eventRows.rows.length === 0) return;
  const state = createInitialGrantState();
  for (const row of eventRows.rows) {
    applyGrantEvent(state, {
      eventType: row.event_type,
      eventData: row.event_data,
      ingestedAt: row.ingested_at,
    });
  }
  checkGrantInvariant(state);

  const grantCycleId = eventRows.rows[0].grant_cycle_id;
  const lastRow = eventRows.rows[eventRows.rows.length - 1];

  for (const [bucket, bucketState] of state) {
    await pool.query(
      `INSERT INTO grant_balances_projection (
        grant_id, grant_cycle_id, bucket_type, awarded_cents, available_cents, encumbered_cents, liquidated_cents, released_cents,
        rate_numerator_cents, rate_denominator_cents, matching_committed_cents, matching_reported_cents,
        rebuilt_at, watermark_ingested_at, watermark_event_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      ON CONFLICT (grant_id, bucket_type) DO UPDATE SET
        grant_cycle_id = EXCLUDED.grant_cycle_id,
        awarded_cents = EXCLUDED.awarded_cents,
        available_cents = EXCLUDED.available_cents,
        encumbered_cents = EXCLUDED.encumbered_cents,
        liquidated_cents = EXCLUDED.liquidated_cents,
        released_cents = EXCLUDED.released_cents,
        rate_numerator_cents = EXCLUDED.rate_numerator_cents,
        rate_denominator_cents = EXCLUDED.rate_denominator_cents,
        matching_committed_cents = EXCLUDED.matching_committed_cents,
        matching_reported_cents = EXCLUDED.matching_reported_cents,
        rebuilt_at = EXCLUDED.rebuilt_at,
        watermark_ingested_at = EXCLUDED.watermark_ingested_at,
        watermark_event_id = EXCLUDED.watermark_event_id
      `,
      [
        grantId,
        grantCycleId,
        bucket,
        bucketState.awardedCents.toString(),
        bucketState.availableCents.toString(),
        bucketState.encumberedCents.toString(),
        bucketState.liquidatedCents.toString(),
        bucketState.releasedCents.toString(),
        bucketState.rateNumeratorCents.toString(),
        bucketState.rateDenominatorCents.toString(),
        bucketState.matchingCommittedCents.toString(),
        bucketState.matchingReportedCents.toString(),
        new Date(),
        lastRow.ingested_at || new Date(),
        lastRow.event_id || uuidv7(),
      ]
    );
  }
}

async function buildVoucherProjection(voucherId: string, grantId: string): Promise<void> {
  const eventRows = await pool.query(
    `SELECT event_type, event_data, ingested_at, event_id
     FROM event_log
     WHERE aggregate_id = $1 AND aggregate_type = 'VOUCHER'
     ORDER BY ingested_at ASC, event_id ASC`,
    [voucherId]
  );
  if (eventRows.rows.length === 0) return;
  const state = createInitialVoucherState(voucherId, grantId);
  for (const row of eventRows.rows) {
    applyVoucherEvent(state, {
      eventType: row.event_type,
      eventData: row.event_data,
      ingestedAt: row.ingested_at,
    });
  }
  checkVoucherInvariant(state);
  const lastRow = eventRows.rows[eventRows.rows.length - 1];

  await pool.query(
    `INSERT INTO vouchers_projection (
      voucher_id, grant_id, voucher_code, county_code, status, max_reimbursement_cents, is_lirp,
      tentative_expires_at, expires_at, issued_at, redeemed_at, expired_at, voided_at,
      rebuilt_at, watermark_ingested_at, watermark_event_id
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
    ON CONFLICT (voucher_id) DO UPDATE SET
      grant_id = EXCLUDED.grant_id,
      voucher_code = EXCLUDED.voucher_code,
      status = EXCLUDED.status,
      max_reimbursement_cents = EXCLUDED.max_reimbursement_cents,
      is_lirp = EXCLUDED.is_lirp,
      tentative_expires_at = EXCLUDED.tentative_expires_at,
      expires_at = EXCLUDED.expires_at,
      issued_at = EXCLUDED.issued_at,
      redeemed_at = EXCLUDED.redeemed_at,
      expired_at = EXCLUDED.expired_at,
      voided_at = EXCLUDED.voided_at,
      rebuilt_at = EXCLUDED.rebuilt_at,
      watermark_ingested_at = EXCLUDED.watermark_ingested_at,
      watermark_event_id = EXCLUDED.watermark_event_id
    `,
    [
      state.voucherId,
      grantId,
      state.voucherCode,
      null,
      state.status,
      state.maxReimbursementCents.toString(),
      state.isLIRP,
      state.tentativeExpiresAt,
      state.expiresAt,
      state.issuedAt,
      state.redeemedAt,
      state.expiredAt,
      state.voidedAt,
      new Date(),
      lastRow.ingested_at || new Date(),
      lastRow.event_id || uuidv7(),
    ]
  );
}

async function buildClaimProjection(claimId: string): Promise<void> {
  const eventRows = await pool.query(
    `SELECT event_id, event_type, event_data, ingested_at
     FROM event_log
     WHERE aggregate_id = $1 AND aggregate_type = 'CLAIM'
     ORDER BY ingested_at ASC, event_id ASC`,
    [claimId]
  );
  if (eventRows.rows.length === 0) return;
  const firstEvent = eventRows.rows[0].event_data;
  const state = createInitialClaimState(
    claimId as any,
    firstEvent.claimFingerprint as any,
    firstEvent.grantCycleId as string,
    firstEvent.voucherId as any,
    firstEvent.clinicId as string,
    firstEvent.procedureCode as string,
    new Date(firstEvent.dateOfService as string)
  );
  for (const row of eventRows.rows) {
    applyClaimEvent(state, {
      eventType: row.event_type,
      eventData: row.event_data,
      ingestedAt: row.ingested_at,
      eventId: row.event_id,
    });
  }
  checkClaimInvariant(state);
  const lastRow = eventRows.rows[eventRows.rows.length - 1];

  await pool.query(
    `INSERT INTO claims_projection (
      claim_id, claim_fingerprint, grant_cycle_id, voucher_id, clinic_id, procedure_code, date_of_service, status,
      submitted_amount_cents, approved_amount_cents, decision_basis, invoice_id,
      submitted_at, approved_at, approved_event_id, denied_at, adjusted_at, invoiced_at,
      rebuilt_at, watermark_ingested_at, watermark_event_id
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
    ON CONFLICT (claim_id) DO UPDATE SET
      status = EXCLUDED.status,
      approved_amount_cents = EXCLUDED.approved_amount_cents,
      decision_basis = EXCLUDED.decision_basis,
      invoice_id = EXCLUDED.invoice_id,
      approved_at = EXCLUDED.approved_at,
      approved_event_id = EXCLUDED.approved_event_id,
      denied_at = EXCLUDED.denied_at,
      adjusted_at = EXCLUDED.adjusted_at,
      invoiced_at = EXCLUDED.invoiced_at,
      rebuilt_at = EXCLUDED.rebuilt_at,
      watermark_ingested_at = EXCLUDED.watermark_ingested_at,
      watermark_event_id = EXCLUDED.watermark_event_id
    `,
    [
      state.claimId,
      state.claimFingerprint,
      state.grantCycleId,
      state.voucherId,
      state.clinicId,
      state.procedureCode,
      state.dateOfService,
      state.status,
      state.submittedAmountCents.toString(),
      state.approvedAmountCents ? state.approvedAmountCents.toString() : null,
      state.decisionBasis ? JSON.stringify(state.decisionBasis) : null,
      state.invoiceId,
      state.submittedAt,
      state.approvedAt,
      state.approvedEventId,
      state.deniedAt,
      state.adjustedAt,
      state.invoicedAt,
      new Date(),
      lastRow.ingested_at || new Date(),
      lastRow.event_id || uuidv7(),
    ]
  );
}

async function buildInvoiceProjection(invoiceId: string): Promise<void> {
  const eventRows = await pool.query(
    `SELECT event_type, event_data, ingested_at, grant_cycle_id, event_id
     FROM event_log
     WHERE aggregate_id = $1 AND aggregate_type = 'INVOICE'
     ORDER BY ingested_at ASC, event_id ASC`,
    [invoiceId]
  );
  if (eventRows.rows.length === 0) return;
  const firstEvent = eventRows.rows[0].event_data;
  const grantCycleId = eventRows.rows[0].grant_cycle_id;
  const state = createInitialInvoiceState(
    invoiceId,
    firstEvent.clinicId as string,
    new Date(firstEvent.periodStart as string),
    new Date(firstEvent.periodEnd as string)
  );
  for (const row of eventRows.rows) {
    applyInvoiceEvent(state, {
      eventType: row.event_type,
      eventData: row.event_data,
      ingestedAt: row.ingested_at,
    });
  }
  checkInvoiceInvariant(state);
  const lastRow = eventRows.rows[eventRows.rows.length - 1];

  const paymentsResult = await pool.query(
    `SELECT COALESCE(SUM(amount_cents), 0) as total_paid FROM payments_projection WHERE invoice_id = $1`,
    [invoiceId]
  );
  const totalPaidCents = Money.fromBigInt(BigInt(paymentsResult.rows[0].total_paid));
  const derivedStatus = computeInvoiceStatus(state.totalAmountCents, totalPaidCents, state.status === 'SUBMITTED');

  await pool.query(
    `INSERT INTO invoices_projection (
      invoice_id, clinic_id, grant_cycle_id, invoice_period_start, invoice_period_end,
      total_amount_cents, claim_ids, adjustment_ids, status, submitted_at, generated_at,
      rebuilt_at, watermark_ingested_at, watermark_event_id
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
    ON CONFLICT (invoice_id) DO UPDATE SET
      grant_cycle_id = EXCLUDED.grant_cycle_id,
      status = EXCLUDED.status,
      submitted_at = EXCLUDED.submitted_at,
      rebuilt_at = EXCLUDED.rebuilt_at,
      watermark_ingested_at = EXCLUDED.watermark_ingested_at,
      watermark_event_id = EXCLUDED.watermark_event_id
    `,
    [
      state.invoiceId,
      state.clinicId,
      grantCycleId,
      state.periodStart,
      state.periodEnd,
      state.totalAmountCents.toString(),
      JSON.stringify(state.claimIds),
      JSON.stringify(state.adjustmentIds),
      derivedStatus,
      state.submittedAt,
      state.generatedAt,
      new Date(),
      lastRow.ingested_at || new Date(),
      lastRow.event_id || uuidv7(),
    ]
  );
}

async function seed(): Promise<void> {
  await resetIfRequested();

  console.log('Seeding demo data...');
  const clinics = await seedClinics();
  const grants = await seedGrants();
  const vouchers = await seedVouchers(grants);
  const claims = await seedClaims(vouchers, clinics);
  await seedVoucherResolutions(vouchers, claims);
  const invoices = await seedInvoices(claims);
  const paymentIds = await seedPayments(invoices);

  // Build projections from the event log
  for (const clinic of clinics) {
    await buildClinicProjection(clinic.clinicId);
  }
  for (const grant of grants) {
    await buildGrantProjection(grant.grantId);
  }
  for (const voucher of vouchers) {
    await buildVoucherProjection(voucher.voucherId, voucher.grantId);
  }
  for (const claim of claims) {
    await buildClaimProjection(claim.claimId);
  }
  for (const paymentId of paymentIds) {
    await buildPaymentProjection(paymentId);
  }
  for (const invoice of invoices) {
    await buildInvoiceProjection(invoice.invoiceId);
  }

  const claimStatusCounts = claims.reduce<Record<string, number>>((acc, claim) => {
    acc[claim.status] = (acc[claim.status] || 0) + 1;
    return acc;
  }, {});

  console.log('Seed complete.');
  console.log(`Clinics: ${clinics.length}`);
  console.log(`Grants: ${grants.length}`);
  console.log(`Vouchers: ${vouchers.length}`);
  console.log(`Claims: ${claims.length}`);
  console.log(`Claim Statuses: ${JSON.stringify(claimStatusCounts)}`);
  console.log(`Invoices: ${invoices.length}`);
  console.log(`Payments: ${paymentIds.length}`);
  console.log('Done.');
}

seed()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error('Seed failed:', error);
    await pool.end();
    process.exit(1);
  });
