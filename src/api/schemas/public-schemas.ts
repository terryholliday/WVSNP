import { z } from 'zod';

const quarterSchema = z.string().regex(/^\d{4}-Q[1-4]$/, 'reportQuarter must be in YYYY-QN format');

export const breederTransferConfirmationSchema = z.object({
  licenseId: z.string().uuid(),
  occurredAt: z.string().datetime(),
  transferId: z.string().min(1),
  microchipId: z.string().min(1).optional(),
  animalCount: z.number().int().positive().default(1),
  notes: z.string().max(4000).optional(),
  correlationId: z.string().uuid().optional(),
});

export const breederTransferConfirmationAmendSchema = z.object({
  occurredAt: z.string().datetime(),
  transferId: z.string().min(1),
  microchipId: z.string().min(1).optional(),
  animalCount: z.number().int().positive().default(1),
  notes: z.string().max(4000).optional(),
  correlationId: z.string().uuid().optional(),
});

export const accidentalLitterRegistrationSchema = z.object({
  licenseId: z.string().uuid(),
  occurredAt: z.string().datetime(),
  litterId: z.string().min(1),
  litterSize: z.number().int().positive(),
  sireId: z.string().optional(),
  damId: z.string().optional(),
  notes: z.string().max(4000).optional(),
  correlationId: z.string().uuid().optional(),
});

export const accidentalLitterRegistrationAmendSchema = z.object({
  occurredAt: z.string().datetime(),
  litterId: z.string().min(1),
  litterSize: z.number().int().positive(),
  sireId: z.string().optional(),
  damId: z.string().optional(),
  notes: z.string().max(4000).optional(),
  correlationId: z.string().uuid().optional(),
});

export const quarterlyTransitionReportSchema = z.object({
  licenseId: z.string().uuid(),
  occurredAt: z.string().datetime(),
  reportQuarter: quarterSchema,
  maintainedBreedingDogs: z.number().int().min(0),
  transfersCompleted: z.number().int().min(0),
  reportDueAt: z.string().datetime(),
  notes: z.string().max(4000).optional(),
  correlationId: z.string().uuid().optional(),
});

export const quarterlyTransitionReportAmendSchema = z.object({
  occurredAt: z.string().datetime(),
  reportQuarter: quarterSchema,
  maintainedBreedingDogs: z.number().int().min(0),
  transfersCompleted: z.number().int().min(0),
  reportDueAt: z.string().datetime(),
  notes: z.string().max(4000).optional(),
  correlationId: z.string().uuid().optional(),
});

export const breederFilingQuerySchema = z.object({
  licenseId: z.string().uuid().optional(),
  filingStatus: z.enum(['SUBMITTED', 'AMENDED']).optional(),
  filingType: z.enum(['TRANSFER_CONFIRMATION', 'ACCIDENTAL_LITTER_REGISTRATION', 'QUARTERLY_TRANSITION_REPORT']).optional(),
  limit: z.string().regex(/^\d+$/).transform(Number).default('50'),
});
