export type BreederFilingType = 'TRANSFER_CONFIRMATION' | 'ACCIDENTAL_LITTER_REGISTRATION' | 'QUARTERLY_TRANSITION_REPORT';

export type BreederComplianceStatus = 'ON_TIME' | 'DUE_SOON' | 'OVERDUE' | 'CURED';

export interface QuarterlyCycle {
  reportingYear: number;
  reportingQuarter: 1 | 2 | 3 | 4;
}

export interface ComplianceStatusInput {
  dueAt: Date;
  asOf: Date;
  submittedAt?: Date | null;
  curedAt?: Date | null;
  curePeriodDays?: number | null;
  dueSoonWindowDays?: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_DUE_SOON_WINDOW_DAYS = 3;
const DEFAULT_QUARTERLY_DUE_OFFSET_DAYS = 30;

export function addUtcDays(base: Date, days: number): Date {
  return new Date(base.getTime() + days * DAY_MS);
}

export function calculateQuarterBounds(cycle: QuarterlyCycle): { quarterStartAt: Date; quarterEndAt: Date } {
  const quarterStartMonth = (cycle.reportingQuarter - 1) * 3;
  const quarterStartAt = new Date(Date.UTC(cycle.reportingYear, quarterStartMonth, 1, 0, 0, 0, 0));
  const quarterEndAt = new Date(Date.UTC(cycle.reportingYear, quarterStartMonth + 3, 0, 23, 59, 59, 999));
  return { quarterStartAt, quarterEndAt };
}

export function calculateDueAt(params: {
  filingType: BreederFilingType;
  occurredAt?: Date;
  dueAt?: Date;
  quarterlyCycle?: QuarterlyCycle;
  quarterlyDueOffsetDays?: number;
}): Date {
  if (params.dueAt) {
    return params.dueAt;
  }

  if (params.filingType === 'TRANSFER_CONFIRMATION') {
    if (!params.occurredAt) {
      throw new Error('MISSING_TRANSFER_OCCURRED_AT');
    }
    return addUtcDays(params.occurredAt, 7);
  }

  if (params.filingType === 'ACCIDENTAL_LITTER_REGISTRATION') {
    if (!params.occurredAt) {
      throw new Error('MISSING_LITTER_OCCURRED_AT');
    }
    return addUtcDays(params.occurredAt, 14);
  }

  if (!params.quarterlyCycle) {
    throw new Error('MISSING_QUARTERLY_CYCLE');
  }

  const { quarterEndAt } = calculateQuarterBounds(params.quarterlyCycle);
  return addUtcDays(quarterEndAt, params.quarterlyDueOffsetDays ?? DEFAULT_QUARTERLY_DUE_OFFSET_DAYS);
}

export function calculateCureDeadlineAt(dueAt: Date, curePeriodDays?: number | null): Date | null {
  if (!curePeriodDays || curePeriodDays <= 0) {
    return null;
  }
  return addUtcDays(dueAt, curePeriodDays);
}

export function calculateComplianceStatus(input: ComplianceStatusInput): BreederComplianceStatus {
  const dueSoonWindowDays = input.dueSoonWindowDays ?? DEFAULT_DUE_SOON_WINDOW_DAYS;
  const cureDeadlineAt = calculateCureDeadlineAt(input.dueAt, input.curePeriodDays);

  if (input.curedAt) {
    return 'CURED';
  }

  if (input.submittedAt) {
    if (input.submittedAt.getTime() <= input.dueAt.getTime()) {
      return 'ON_TIME';
    }
    if (cureDeadlineAt && input.submittedAt.getTime() <= cureDeadlineAt.getTime()) {
      return 'CURED';
    }
    return 'OVERDUE';
  }

  const msUntilDue = input.dueAt.getTime() - input.asOf.getTime();
  if (msUntilDue < 0) {
    return 'OVERDUE';
  }

  if (msUntilDue <= dueSoonWindowDays * DAY_MS) {
    return 'DUE_SOON';
  }

  return 'ON_TIME';
}

export function toIsoStringOrNull(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}
