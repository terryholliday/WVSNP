import { Router } from 'express';
import { Pool } from 'pg';
import { ApiError } from '../middleware/auth';

export function createPublicRoutes(pool: Pool) {
  const router = Router();

  // Lookup Voucher by Code (for found pet scenarios)
  router.get('/vouchers/:voucherCode', async (req, res, next) => {
    try {
      const { voucherCode } = req.params;

      const result = await pool.query(
        `SELECT voucher_id, voucher_code, status, issued_at, redeemed_at, expired_at, voided_at
         FROM vouchers_projection
         WHERE voucher_code = $1`,
        [voucherCode]
      );

      if (result.rows.length === 0) {
        throw new ApiError(404, 'VOUCHER_NOT_FOUND', 'Voucher not found');
      }

      const voucher = result.rows[0];

      res.json({
        voucherId: voucher.voucher_id,
        voucherCode: voucher.voucher_code,
        status: voucher.status,
        issuedAt: voucher.issued_at?.toISOString(),
        redeemedAt: voucher.redeemed_at?.toISOString(),
        expiredAt: voucher.expired_at?.toISOString(),
        voidedAt: voucher.voided_at?.toISOString()
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
