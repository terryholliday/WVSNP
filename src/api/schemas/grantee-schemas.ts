import { z } from 'zod';

// Issue Voucher Schema
export const issueVoucherSchema = z.object({
  grantId: z.string().uuid(),
  countyCode: z.string(),
  procedureType: z.string(),
  maxReimbursementCents: z.string().regex(/^\d+$/),
  isLIRP: z.boolean(),
  expiresAt: z.string().datetime()
});

// Issue Tentative Voucher Schema
export const issueTentativeVoucherSchema = z.object({
  grantId: z.string().uuid(),
  countyCode: z.string(),
  procedureType: z.string(),
  maxReimbursementCents: z.string().regex(/^\d+$/),
  tentativeExpiresAt: z.string().datetime()
});

// Confirm Tentative Voucher Schema
export const confirmTentativeVoucherSchema = z.object({
  expiresAt: z.string().datetime()
});

// List Vouchers Query Schema
export const listVouchersQuerySchema = z.object({
  status: z.enum(['TENTATIVE', 'ISSUED', 'REDEEMED', 'EXPIRED', 'VOIDED']).optional(),
  countyCode: z.string().optional(),
  limit: z.string().regex(/^\d+$/).transform(Number).default('50'),
  cursor: z.string().optional()
});
