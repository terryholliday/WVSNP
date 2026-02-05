/**
 * API Key Authentication Middleware
 *
 * Authentication model:
 * - CLINIC: Vet clinics accessing via VetOS integration
 * - GRANTEE: County grantees accessing via ShelterOS integration
 * - ADMIN: WVDA administrative staff
 *
 * API keys are stored in api_keys table with:
 * - api_key_id: The key sent in Authorization header
 * - api_key_hash: SHA-256 hash of the full key (for lookup)
 * - client_type: CLINIC | GRANTEE | ADMIN
 * - client_id: Reference to clinic_id, grantee_id, or admin_user_id
 * - grant_cycle_id: Scoped to specific grant cycle
 * - permissions: Array of allowed operations
 * - expires_at: Key expiration
 * - revoked_at: If key was revoked
 */

import { Request, Response, NextFunction } from 'express';
import { Pool } from 'pg';
import crypto from 'crypto';
import { ApiCredentials, ApiClientType, ApiResponse } from '../types';

// Extend Express Request to include credentials
declare global {
  namespace Express {
    interface Request {
      credentials?: ApiCredentials;
    }
  }
}

// Permission constants
export const PERMISSIONS = {
  // Voucher operations (ShelterOS/GRANTEE)
  VOUCHER_ISSUE: 'voucher:issue',
  VOUCHER_READ: 'voucher:read',
  VOUCHER_CANCEL: 'voucher:cancel',

  // Claim operations (VetOS/CLINIC)
  CLAIM_SUBMIT: 'claim:submit',
  CLAIM_READ: 'claim:read',
  VOUCHER_VALIDATE: 'voucher:validate',

  // Payment operations (VetOS/CLINIC reads)
  PAYMENT_READ: 'payment:read',

  // Grant operations (ShelterOS/GRANTEE + ADMIN)
  GRANT_READ: 'grant:read',
  REPORT_READ: 'report:read',

  // Admin operations (WVDA only)
  CLAIM_ADJUDICATE: 'claim:adjudicate',
  INVOICE_GENERATE: 'invoice:generate',
  OASIS_EXPORT: 'oasis:export',
  CLOSEOUT_MANAGE: 'closeout:manage',
} as const;

// Default permissions by client type
export const DEFAULT_PERMISSIONS: Record<ApiClientType, string[]> = {
  CLINIC: [
    PERMISSIONS.CLAIM_SUBMIT,
    PERMISSIONS.CLAIM_READ,
    PERMISSIONS.VOUCHER_VALIDATE,
    PERMISSIONS.PAYMENT_READ,
  ],
  GRANTEE: [
    PERMISSIONS.VOUCHER_ISSUE,
    PERMISSIONS.VOUCHER_READ,
    PERMISSIONS.VOUCHER_CANCEL,
    PERMISSIONS.GRANT_READ,
    PERMISSIONS.REPORT_READ,
  ],
  ADMIN: [
    // Admin has all permissions
    ...Object.values(PERMISSIONS),
  ],
};

export function createAuthMiddleware(pool: Pool) {
  return async function authenticate(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      const response: ApiResponse<null> = {
        success: false,
        error: {
          code: 'MISSING_AUTHORIZATION',
          message: 'Authorization header is required',
        },
      };
      res.status(401).json(response);
      return;
    }

    // Expect: "Bearer <api_key>"
    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      const response: ApiResponse<null> = {
        success: false,
        error: {
          code: 'INVALID_AUTHORIZATION_FORMAT',
          message: 'Authorization header must be: Bearer <api_key>',
        },
      };
      res.status(401).json(response);
      return;
    }

    const apiKey = parts[1];

    // Hash the key for lookup
    const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');

    try {
      const result = await pool.query(
        `SELECT
          api_key_id,
          client_type,
          client_id,
          grant_cycle_id,
          permissions,
          expires_at,
          revoked_at
        FROM api_keys
        WHERE api_key_hash = $1`,
        [keyHash]
      );

      if (result.rows.length === 0) {
        const response: ApiResponse<null> = {
          success: false,
          error: {
            code: 'INVALID_API_KEY',
            message: 'API key is invalid or not found',
          },
        };
        res.status(401).json(response);
        return;
      }

      const keyRecord = result.rows[0];

      // Check if revoked
      if (keyRecord.revoked_at) {
        const response: ApiResponse<null> = {
          success: false,
          error: {
            code: 'API_KEY_REVOKED',
            message: 'API key has been revoked',
          },
        };
        res.status(401).json(response);
        return;
      }

      // Check if expired
      if (keyRecord.expires_at && new Date(keyRecord.expires_at) < new Date()) {
        const response: ApiResponse<null> = {
          success: false,
          error: {
            code: 'API_KEY_EXPIRED',
            message: 'API key has expired',
          },
        };
        res.status(401).json(response);
        return;
      }

      // Attach credentials to request
      req.credentials = {
        apiKeyId: keyRecord.api_key_id,
        clientType: keyRecord.client_type as ApiClientType,
        clientId: keyRecord.client_id,
        grantCycleId: keyRecord.grant_cycle_id,
        permissions: keyRecord.permissions || DEFAULT_PERMISSIONS[keyRecord.client_type as ApiClientType],
      };

      next();
    } catch (error) {
      console.error('Auth middleware error:', error);
      const response: ApiResponse<null> = {
        success: false,
        error: {
          code: 'AUTH_ERROR',
          message: 'Authentication failed',
        },
      };
      res.status(500).json(response);
    }
  };
}

/**
 * Permission check middleware factory
 */
export function requirePermission(...requiredPermissions: string[]) {
  return function checkPermission(
    req: Request,
    res: Response,
    next: NextFunction
  ): void {
    if (!req.credentials) {
      const response: ApiResponse<null> = {
        success: false,
        error: {
          code: 'NOT_AUTHENTICATED',
          message: 'Authentication required',
        },
      };
      res.status(401).json(response);
      return;
    }

    const hasPermission = requiredPermissions.every(
      perm => req.credentials!.permissions.includes(perm)
    );

    if (!hasPermission) {
      const response: ApiResponse<null> = {
        success: false,
        error: {
          code: 'INSUFFICIENT_PERMISSIONS',
          message: `Required permissions: ${requiredPermissions.join(', ')}`,
        },
      };
      res.status(403).json(response);
      return;
    }

    next();
  };
}

/**
 * Client type check middleware factory
 */
export function requireClientType(...allowedTypes: ApiClientType[]) {
  return function checkClientType(
    req: Request,
    res: Response,
    next: NextFunction
  ): void {
    if (!req.credentials) {
      const response: ApiResponse<null> = {
        success: false,
        error: {
          code: 'NOT_AUTHENTICATED',
          message: 'Authentication required',
        },
      };
      res.status(401).json(response);
      return;
    }

    if (!allowedTypes.includes(req.credentials.clientType)) {
      const response: ApiResponse<null> = {
        success: false,
        error: {
          code: 'CLIENT_TYPE_NOT_ALLOWED',
          message: `This endpoint requires client type: ${allowedTypes.join(' or ')}`,
        },
      };
      res.status(403).json(response);
      return;
    }

    next();
  };
}

/**
 * Verify the requesting client can access a specific resource
 * (e.g., clinic can only read their own claims)
 */
export function requireResourceAccess(
  getResourceOwnerId: (req: Request) => string | undefined
) {
  return function checkResourceAccess(
    req: Request,
    res: Response,
    next: NextFunction
  ): void {
    if (!req.credentials) {
      const response: ApiResponse<null> = {
        success: false,
        error: {
          code: 'NOT_AUTHENTICATED',
          message: 'Authentication required',
        },
      };
      res.status(401).json(response);
      return;
    }

    // Admins can access any resource
    if (req.credentials.clientType === 'ADMIN') {
      next();
      return;
    }

    const resourceOwnerId = getResourceOwnerId(req);
    if (resourceOwnerId && resourceOwnerId !== req.credentials.clientId) {
      const response: ApiResponse<null> = {
        success: false,
        error: {
          code: 'RESOURCE_ACCESS_DENIED',
          message: 'You do not have access to this resource',
        },
      };
      res.status(403).json(response);
      return;
    }

    next();
  };
}
