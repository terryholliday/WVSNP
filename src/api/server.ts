import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { Pool } from 'pg';
import { EventStore } from '../event-store';
import { IdempotencyService } from '../application/idempotency-service';
import { createAuthMiddleware } from './middleware/auth';
import { errorHandler, notFoundHandler } from './middleware/error-handler';
import { requestLogger } from './middleware/request-logger';
import { createClinicRoutes } from './routes/clinic-routes';
import { createGranteeRoutes } from './routes/grantee-routes';
import { createAdminRoutes } from './routes/admin-routes';
import { createPublicRoutes } from './routes/public-routes';

// Environment configuration
const PORT = process.env.API_PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/wvsnp_gms';

// Initialize database and services
export const apiPool = new Pool({ connectionString: DATABASE_URL });
const pool = apiPool;
const eventStore = new EventStore(pool);
const idempotency = new IdempotencyService(pool);

// Create Express app
const app = express();

// Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/v1', limiter);

// Public endpoints have stricter rate limiting
const publicLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 requests per minute
  standardHeaders: true,
  legacyHeaders: false,
});

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging
app.use(requestLogger);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API documentation placeholder
app.get('/api/docs', (req, res) => {
  res.json({
    message: 'WVSNP-GMS API v1',
    documentation: 'See WINDSURF_03_Phase5_API_v5.2.md for full API specification',
    endpoints: {
      clinic: '/api/v1/clinics/*',
      grantee: '/api/v1/grantees/*',
      admin: '/api/v1/admin/*',
      public: '/api/v1/public/*'
    }
  });
});

// Create authentication middleware
const authenticate = createAuthMiddleware(pool, JWT_SECRET);

// Mount routes
app.use('/api/v1/clinics', authenticate('clinic'), createClinicRoutes(pool, eventStore, idempotency));
app.use('/api/v1/grantees', authenticate('grantee'), createGranteeRoutes(pool, eventStore, idempotency));
app.use('/api/v1/admin', authenticate('admin'), createAdminRoutes(pool, eventStore, idempotency));
app.use('/api/v1/public', publicLimiter, authenticate('public'), createPublicRoutes(pool));

// Error handlers (must be last)
app.use(notFoundHandler);
app.use(errorHandler);

// Start server
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`[API Server] Listening on port ${PORT}`);
    console.log(`[API Server] Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`[API Server] Database: ${DATABASE_URL.replace(/:[^:@]+@/, ':****@')}`);
  });
}

export default app;

export async function closeApiPool(): Promise<void> {
  await pool.end();
}
