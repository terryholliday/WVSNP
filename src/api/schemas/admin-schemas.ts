import { z } from 'zod';

// Approve Claim Schema
export const approveClaimSchema = z.object({
  approvedAmountCents: z.string().regex(/^\d+$/),
  policySnapshotId: z.string().uuid(),
  reason: z.string().optional()
});

// Deny Claim Schema
export const denyClaimSchema = z.object({
  policySnapshotId: z.string().uuid(),
  reason: z.string()
});

// Generate Monthly Invoices Schema
export const generateMonthlyInvoicesSchema = z.object({
  year: z.number().int().min(2020).max(2100),
  month: z.number().int().min(1).max(12),
  watermarkIngestedAt: z.string().datetime(),
  watermarkEventId: z.string().uuid()
});

// Generate OASIS Export Schema
export const generateOasisExportSchema = z.object({
  grantCycleId: z.string().uuid(),
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  watermarkIngestedAt: z.string().datetime(),
  watermarkEventId: z.string().uuid()
});

// List Claims Query Schema
export const listClaimsAdminQuerySchema = z.object({
  status: z.enum(['SUBMITTED', 'APPROVED', 'DENIED', 'ADJUSTED', 'INVOICED']).optional(),
  clinicId: z.string().uuid().optional(),
  grantCycleId: z.string().uuid().optional(),
  limit: z.string().regex(/^\d+$/).transform(Number).default('50'),
  cursor: z.string().optional()
});
