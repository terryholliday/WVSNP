import { Request, Response, NextFunction } from 'express';
import { ApiError } from './auth';

export function errorHandler(err: any, req: Request, res: Response, next: NextFunction) {
  // Log error for debugging
  console.error('[API Error]', {
    correlationId: req.correlationId,
    path: req.path,
    method: req.method,
    error: err.message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });

  // Handle known API errors
  if (err instanceof ApiError) {
    return res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
        details: err.details,
        correlationId: req.correlationId
      }
    });
  }

  // Map service errors to HTTP errors
  const errorMap: Record<string, { status: number; code: string; message: string }> = {
    'VOUCHER_EXPIRED': { status: 422, code: 'VOUCHER_EXPIRED', message: 'Voucher has expired' },
    'VOUCHER_ALREADY_REDEEMED': { status: 422, code: 'VOUCHER_ALREADY_REDEEMED', message: 'Voucher has already been redeemed' },
    'CLINIC_NOT_ACTIVE': { status: 403, code: 'CLINIC_NOT_ACTIVE', message: 'Clinic is not active' },
    'GRANT_PERIOD_ENDED': { status: 422, code: 'GRANT_PERIOD_ENDED', message: 'Grant period has ended' },
    'GRANT_CLAIMS_DEADLINE_PASSED': { status: 422, code: 'GRANT_CLAIMS_DEADLINE_PASSED', message: 'Claims deadline has passed' },
    'GRANT_CYCLE_CLOSED': { status: 422, code: 'GRANT_CYCLE_CLOSED', message: 'Grant cycle is closed' },
    'INSUFFICIENT_FUNDS': { status: 422, code: 'INSUFFICIENT_FUNDS', message: 'Insufficient grant funds' },
    'CLAIM_NOT_SUBMITTED': { status: 422, code: 'CLAIM_NOT_SUBMITTED', message: 'Claim is not in submitted status' },
    'LIRP_COPAY_FORBIDDEN': { status: 422, code: 'LIRP_COPAY_FORBIDDEN', message: 'LIRP vouchers cannot have co-pay' },
    'OPERATION_IN_PROGRESS': { status: 409, code: 'OPERATION_IN_PROGRESS', message: 'Operation already in progress' },
  };

  const mapped = errorMap[err.message];
  if (mapped) {
    return res.status(mapped.status).json({
      error: {
        code: mapped.code,
        message: mapped.message,
        correlationId: req.correlationId
      }
    });
  }

  // Never leak internal errors to client
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
      correlationId: req.correlationId
    }
  });
}

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: `Route ${req.method} ${req.path} not found`,
      correlationId: req.correlationId
    }
  });
}
