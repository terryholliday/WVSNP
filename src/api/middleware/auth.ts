import { Request, Response, NextFunction } from 'express';
import { Pool } from 'pg';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

export interface AuthContext {
  entityType?: 'CLINIC' | 'GRANTEE';
  entityId?: string;
  scopes?: string[];
  userId?: string;
  role?: string;
  permissions?: string[];
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
      correlationId?: string;
    }
  }
}

export class ApiError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details?: any
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function createAuthMiddleware(pool: Pool, jwtSecret: string) {
  return function authenticate(entityType: 'clinic' | 'grantee' | 'admin' | 'public') {
    return async (req: Request, res: Response, next: NextFunction) => {
      // Public endpoints don't require auth
      if (entityType === 'public') {
        return next();
      }

      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith('Bearer ')) {
        return res.status(401).json({
          error: {
            code: 'MISSING_AUTH',
            message: 'Authorization header required',
            correlationId: req.correlationId
          }
        });
      }

      const token = authHeader.substring(7);

      try {
        if (entityType === 'admin') {
          // JWT validation for admin users
          const decoded = jwt.verify(token, jwtSecret) as any;
          req.auth = {
            userId: decoded.sub,
            role: decoded.role,
            permissions: decoded.permissions || []
          };
        } else {
          // API key validation for clinics/grantees
          const keyHash = crypto.createHash('sha256').update(token, 'utf8').digest('hex');
          
          const result = await pool.query(
            `SELECT key_id, entity_type, entity_id, scopes, revoked_at, expires_at
             FROM api_keys
             WHERE key_hash = $1`,
            [keyHash]
          );

          if (result.rows.length === 0) {
            return res.status(401).json({
              error: {
                code: 'INVALID_API_KEY',
                message: 'API key is invalid',
                correlationId: req.correlationId
              }
            });
          }

          const key = result.rows[0];

          if (key.revoked_at) {
            return res.status(401).json({
              error: {
                code: 'API_KEY_REVOKED',
                message: 'API key has been revoked',
                correlationId: req.correlationId
              }
            });
          }

          if (key.expires_at && new Date(key.expires_at) < new Date()) {
            return res.status(401).json({
              error: {
                code: 'API_KEY_EXPIRED',
                message: 'API key has expired',
                correlationId: req.correlationId
              }
            });
          }

          if (key.entity_type.toLowerCase() !== entityType) {
            return res.status(403).json({
              error: {
                code: 'WRONG_ENTITY_TYPE',
                message: `This endpoint requires ${entityType} credentials`,
                correlationId: req.correlationId
              }
            });
          }

          // Update last_used_at
          await pool.query(
            'UPDATE api_keys SET last_used_at = NOW() WHERE key_hash = $1',
            [keyHash]
          );

          req.auth = {
            entityType: key.entity_type,
            entityId: key.entity_id,
            scopes: key.scopes || []
          };
        }

        next();
      } catch (error) {
        if (error instanceof jwt.JsonWebTokenError) {
          return res.status(401).json({
            error: {
              code: 'INVALID_JWT',
              message: 'JWT token is invalid or expired',
              correlationId: req.correlationId
            }
          });
        }
        next(error);
      }
    };
  };
}

export function requirePermission(permission: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth?.permissions?.includes(permission)) {
      return res.status(403).json({
        error: {
          code: 'INSUFFICIENT_PERMISSIONS',
          message: `Required permission: ${permission}`,
          correlationId: req.correlationId
        }
      });
    }
    next();
  };
}
