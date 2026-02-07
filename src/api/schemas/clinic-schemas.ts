import { z } from 'zod';

// Submit Claim Schema
export const submitClaimSchema = z.object({
  voucherId: z.string().uuid(),
  procedureCode: z.string(),
  dateOfService: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  submittedAmountCents: z.string().regex(/^\d+$/),
  coPayCollectedCents: z.string().regex(/^\d+$/).optional(),
  artifacts: z.object({
    procedureReport: z.string(),
    clinicInvoice: z.string(),
    rabiesVaccineProof: z.string().optional(),
    preOpPhoto: z.string().optional(),
    postOpPhoto: z.string().optional()
  })
});

// List Claims Query Schema
export const listClaimsQuerySchema = z.object({
  status: z.enum(['SUBMITTED', 'APPROVED', 'DENIED', 'ADJUSTED', 'INVOICED']).optional(),
  limit: z.string().regex(/^\d+$/).transform(Number).default('50'),
  cursor: z.string().optional()
});

// List Invoices Query Schema
export const listInvoicesQuerySchema = z.object({
  status: z.enum(['GENERATED', 'SUBMITTED', 'PAID', 'PARTIALLY_PAID']).optional(),
  limit: z.string().regex(/^\d+$/).transform(Number).default('50'),
  cursor: z.string().optional()
});
