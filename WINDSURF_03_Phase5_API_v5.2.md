# WINDSURF — BUILD PHASE 5 (v5.2) REST API LAYER

> **Role:** Windsurf (Execution Layer Only)  
> **Scope:** Implement REST API wrapper over existing services  
> **Prerequisite:** Phases 1–4 stable + v5.3 patched  
> **DO NOT** redesign domain logic. Expose existing services via HTTP.

---

## ABSOLUTE CANON (NON-NEGOTIABLE)

| Rule | Requirement |
|------|-------------|
| **Thin Layer** | API is a thin HTTP wrapper. Business logic stays in services. |
| **No Duplication** | Do NOT reimplement validation, state machines, or calculations in routes. |
| **Fail-Closed** | Missing auth → 401. Invalid input → 400. Service error → 500. |
| **Idempotency** | POST operations use idempotency keys. GET/PUT are naturally idempotent. |
| **Trace Propagation** | Every request generates `correlationId`. Pass to services. |
| **Error Contracts** | Structured error responses. Never leak stack traces to clients. |
| **OpenAPI First** | Document endpoints before implementing. Spec is contract. |

---

## PHASE 5 OBJECTIVES

```
A) Express.js API Server
   - Middleware: auth, error handling, request validation, logging
   - Three client contexts: VetOS (clinics), ShelterOS (grantees), WVDA (admin)
   - Rate limiting, CORS, helmet security

B) Authentication Strategy
   - API keys for clinic/grantee access (scoped to entity)
   - JWT tokens for WVDA admin users (role-based)
   - No session state (stateless)

C) Endpoint Groups
   - /api/v1/clinics/* — VetOS operations (claim submission, invoice viewing)
   - /api/v1/grantees/* — ShelterOS operations (voucher issuance, status)
   - /api/v1/admin/* — WVDA operations (adjudication, export, closeout)
   - /api/v1/public/* — Voucher lookup (no auth)

D) OpenAPI Documentation
   - Swagger UI at /api/docs
   - JSON spec at /api/openapi.json
   - Request/response schemas
```

---

# SECTION 1 — API STRUCTURE

## 1A: Directory Layout

```
src/
  api/
    server.ts              — Express app setup
    middleware/
      auth.ts              — API key + JWT validation
      error-handler.ts     — Centralized error responses
      request-logger.ts    — Structured logging
      validator.ts         — Zod schema validation
    routes/
      clinic-routes.ts     — VetOS endpoints
      grantee-routes.ts    — ShelterOS endpoints
      admin-routes.ts      — WVDA endpoints
      public-routes.ts     — Unauthenticated endpoints
    schemas/
      clinic-schemas.ts    — Zod request/response schemas
      grantee-schemas.ts
      admin-schemas.ts
    openapi/
      spec.ts              — OpenAPI 3.0 definition
```

## 1B: Port & Base Path

```
Development: http://localhost:4000/api/v1
Production: https://gms.wvsnp.org/api/v1
```

---

# SECTION 2 — AUTHENTICATION

## 2A: API Keys (Clinics & Grantees)

**Format:** `wvsnp_clinic_<32-hex>` or `wvsnp_grantee_<32-hex>`

**Storage:**
```sql
CREATE TABLE api_keys (
  key_id UUID PRIMARY KEY,
  key_hash VARCHAR(64) NOT NULL,  -- SHA-256 of full key
  key_prefix VARCHAR(20) NOT NULL,  -- First 12 chars for display
  entity_type VARCHAR(10) NOT NULL,  -- 'CLINIC' or 'GRANTEE'
  entity_id UUID NOT NULL,
  scopes JSONB NOT NULL,  -- ['claims:submit', 'invoices:read']
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ
);

CREATE INDEX idx_api_keys_hash ON api_keys(key_hash);
```

**Validation:**
```typescript
Authorization: Bearer wvsnp_clinic_abc123...
→ Hash key, lookup in api_keys table
→ Check not expired, not revoked
→ Attach { entityType, entityId, scopes } to req.auth
```

## 2B: JWT Tokens (WVDA Admin)

**Format:** Standard JWT with claims:
```json
{
  "sub": "user_id",
  "email": "admin@wvda.gov",
  "role": "ADJUDICATOR" | "FINANCE" | "ADMIN",
  "permissions": ["claims:approve", "claims:deny", "exports:generate"],
  "iat": 1234567890,
  "exp": 1234571490
}
```

**Validation:**
```typescript
Authorization: Bearer eyJhbGc...
→ Verify signature (RS256 or HS256)
→ Check expiration
→ Attach { userId, role, permissions } to req.auth
```

## 2C: Public Endpoints (No Auth)

```
GET /api/v1/public/vouchers/:voucherCode
  → Lookup voucher status (for found pet scenarios)
  → Rate limited by IP (10 req/min)
```

---

# SECTION 3 — CLINIC ENDPOINTS (VetOS)

## 3A: Submit Claim

```
POST /api/v1/clinics/claims
Authorization: Bearer wvsnp_clinic_...
Idempotency-Key: <uuid>

Request:
{
  "voucherId": "uuid",
  "procedureCode": "SPAY_DOG",
  "dateOfService": "2026-06-15",
  "submittedAmountCents": "15000",
  "coPayCollectedCents": "0",
  "artifacts": {
    "procedureReport": "artifact_id",
    "clinicInvoice": "artifact_id",
    "rabiesVaccineProof": "artifact_id"  // conditional
  }
}

Response 201:
{
  "claimId": "uuid",
  "status": "SUBMITTED",
  "submittedAt": "2026-06-15T14:30:00Z"
}

Errors:
400 — Invalid voucher, expired, already used
403 — Clinic not authorized for this voucher
422 — Validation failed (missing artifacts, invalid procedure)
```

**Implementation:**
```typescript
router.post('/claims', authenticate('clinic'), validate(submitClaimSchema), async (req, res) => {
  const { clinicId } = req.auth;
  const claimService = new ClaimService(pool, eventStore, idempotency);
  
  const result = await claimService.submitClaim({
    idempotencyKey: req.headers['idempotency-key'],
    clinicId,
    voucherId: req.body.voucherId,
    // ... map request to service params
    correlationId: req.correlationId,
    actorId: clinicId,
    actorType: 'CLINIC'
  });
  
  res.status(201).json(result);
});
```

## 3B: List Claims

```
GET /api/v1/clinics/claims?status=SUBMITTED&limit=50&cursor=<base64>
Authorization: Bearer wvsnp_clinic_...

Response 200:
{
  "claims": [
    {
      "claimId": "uuid",
      "voucherId": "uuid",
      "procedureCode": "SPAY_DOG",
      "status": "APPROVED",
      "submittedAt": "2026-06-15T14:30:00Z",
      "approvedAt": "2026-06-16T10:00:00Z",
      "approvedAmountCents": "15000"
    }
  ],
  "nextCursor": "<base64>",
  "hasMore": true
}
```

## 3C: Get Claim Details

```
GET /api/v1/clinics/claims/:claimId
Authorization: Bearer wvsnp_clinic_...

Response 200:
{
  "claimId": "uuid",
  "voucherId": "uuid",
  "procedureCode": "SPAY_DOG",
  "dateOfService": "2026-06-15",
  "status": "APPROVED",
  "submittedAmountCents": "15000",
  "approvedAmountCents": "15000",
  "decisionBasis": {
    "policySnapshotId": "uuid",
    "decidedBy": "admin_id",
    "decidedAt": "2026-06-16T10:00:00Z",
    "reason": "Approved per standard rate schedule"
  },
  "invoiceId": "uuid",
  "artifacts": { ... }
}
```

## 3D: List Invoices

```
GET /api/v1/clinics/invoices?status=SUBMITTED&limit=50
Authorization: Bearer wvsnp_clinic_...

Response 200:
{
  "invoices": [
    {
      "invoiceId": "uuid",
      "periodStart": "2026-06-01",
      "periodEnd": "2026-06-30",
      "totalAmountCents": "150000",
      "status": "PAID",
      "claimCount": 10,
      "generatedAt": "2026-07-01T00:00:00Z",
      "paidAt": "2026-07-15T12:00:00Z"
    }
  ]
}
```

---

# SECTION 4 — GRANTEE ENDPOINTS (ShelterOS)

## 4A: Issue Voucher

```
POST /api/v1/grantees/vouchers
Authorization: Bearer wvsnp_grantee_...
Idempotency-Key: <uuid>

Request:
{
  "grantId": "uuid",
  "countyCode": "KANAWHA",
  "procedureType": "SPAY_DOG",
  "maxReimbursementCents": "15000",
  "isLIRP": false,
  "expiresAt": "2026-12-31T23:59:59Z"
}

Response 201:
{
  "voucherId": "uuid",
  "voucherCode": "KAN-2026-001234",
  "status": "ISSUED",
  "issuedAt": "2026-06-15T14:30:00Z"
}
```

## 4B: Issue Tentative Voucher

```
POST /api/v1/grantees/vouchers/tentative
Authorization: Bearer wvsnp_grantee_...
Idempotency-Key: <uuid>

Request:
{
  "grantId": "uuid",
  "countyCode": "KANAWHA",
  "procedureType": "SPAY_DOG",
  "maxReimbursementCents": "15000",
  "tentativeExpiresAt": "2026-06-22T23:59:59Z"  // 7 days
}

Response 201:
{
  "voucherId": "uuid",
  "voucherCode": "KAN-2026-T001234",
  "status": "TENTATIVE",
  "tentativeExpiresAt": "2026-06-22T23:59:59Z"
}
```

## 4C: Confirm Tentative Voucher

```
POST /api/v1/grantees/vouchers/:voucherId/confirm
Authorization: Bearer wvsnp_grantee_...
Idempotency-Key: <uuid>

Request:
{
  "expiresAt": "2026-12-31T23:59:59Z"
}

Response 200:
{
  "voucherId": "uuid",
  "status": "ISSUED",
  "confirmedAt": "2026-06-18T10:00:00Z"
}
```

## 4D: List Vouchers

```
GET /api/v1/grantees/vouchers?status=ISSUED&countyCode=KANAWHA&limit=50
Authorization: Bearer wvsnp_grantee_...

Response 200:
{
  "vouchers": [
    {
      "voucherId": "uuid",
      "voucherCode": "KAN-2026-001234",
      "status": "REDEEMED",
      "procedureType": "SPAY_DOG",
      "issuedAt": "2026-06-15T14:30:00Z",
      "redeemedAt": "2026-06-20T09:00:00Z"
    }
  ]
}
```

---

# SECTION 5 — ADMIN ENDPOINTS (WVDA)

## 5A: List Claims for Adjudication

```
GET /api/v1/admin/claims?status=SUBMITTED&limit=50
Authorization: Bearer <jwt>
Required-Permission: claims:view

Response 200:
{
  "claims": [
    {
      "claimId": "uuid",
      "clinicId": "uuid",
      "clinicName": "Happy Paws Vet",
      "voucherId": "uuid",
      "procedureCode": "SPAY_DOG",
      "dateOfService": "2026-06-15",
      "submittedAmountCents": "15000",
      "submittedAt": "2026-06-15T14:30:00Z",
      "artifacts": { ... }
    }
  ]
}
```

## 5B: Approve Claim

```
POST /api/v1/admin/claims/:claimId/approve
Authorization: Bearer <jwt>
Required-Permission: claims:approve
Idempotency-Key: <uuid>

Request:
{
  "approvedAmountCents": "15000",
  "policySnapshotId": "uuid",
  "reason": "Approved per standard rate schedule"
}

Response 200:
{
  "claimId": "uuid",
  "status": "APPROVED",
  "approvedAt": "2026-06-16T10:00:00Z"
}
```

## 5C: Deny Claim

```
POST /api/v1/admin/claims/:claimId/deny
Authorization: Bearer <jwt>
Required-Permission: claims:deny
Idempotency-Key: <uuid>

Request:
{
  "policySnapshotId": "uuid",
  "reason": "Procedure not covered under grant terms"
}

Response 200:
{
  "claimId": "uuid",
  "status": "DENIED",
  "deniedAt": "2026-06-16T10:00:00Z"
}
```

## 5D: Generate Monthly Invoices

```
POST /api/v1/admin/invoices/generate
Authorization: Bearer <jwt>
Required-Permission: invoices:generate
Idempotency-Key: <uuid>

Request:
{
  "year": 2026,
  "month": 6,
  "watermarkIngestedAt": "2026-07-01T00:00:00Z",
  "watermarkEventId": "uuid"
}

Response 200:
{
  "invoiceIds": ["uuid1", "uuid2", "uuid3"],
  "totalInvoices": 3,
  "totalAmountCents": "450000"
}
```

## 5E: Generate OASIS Export

```
POST /api/v1/admin/exports/oasis
Authorization: Bearer <jwt>
Required-Permission: exports:generate
Idempotency-Key: <uuid>

Request:
{
  "grantCycleId": "uuid",
  "periodStart": "2026-06-01",
  "periodEnd": "2026-06-30",
  "watermarkIngestedAt": "2026-07-01T00:00:00Z",
  "watermarkEventId": "uuid"
}

Response 200:
{
  "exportBatchId": "uuid",
  "batchCode": "WVSNP-2026-06",
  "recordCount": 25,
  "controlTotalCents": "375000",
  "artifactId": "uuid",
  "fileSha256": "abc123...",
  "downloadUrl": "/api/v1/admin/exports/:exportBatchId/download"
}
```

## 5F: Run Closeout Preflight

```
POST /api/v1/admin/closeout/:grantCycleId/preflight
Authorization: Bearer <jwt>
Required-Permission: closeout:manage
Idempotency-Key: <uuid>

Response 200:
{
  "status": "PASSED" | "FAILED",
  "checks": [
    { "check": "ALL_APPROVED_CLAIMS_INVOICED", "pass": true, "details": "" },
    { "check": "ALL_SUBMITTED_INVOICES_EXPORTED", "pass": false, "details": "3 invoices not exported" }
  ]
}
```

---

# SECTION 6 — ERROR HANDLING

## 6A: Standard Error Response

```json
{
  "error": {
    "code": "VOUCHER_EXPIRED",
    "message": "Voucher KAN-2026-001234 expired on 2026-06-30",
    "details": {
      "voucherId": "uuid",
      "expiresAt": "2026-06-30T23:59:59Z"
    },
    "correlationId": "uuid"
  }
}
```

## 6B: HTTP Status Codes

| Code | Meaning | When to Use |
|------|---------|-------------|
| 200 | OK | Successful GET/POST/PUT |
| 201 | Created | Resource created (claim, voucher, etc.) |
| 400 | Bad Request | Invalid input, validation failed |
| 401 | Unauthorized | Missing or invalid auth token |
| 403 | Forbidden | Valid auth but insufficient permissions |
| 404 | Not Found | Resource doesn't exist |
| 409 | Conflict | Duplicate operation (idempotency key reuse) |
| 422 | Unprocessable Entity | Business rule violation (expired voucher, etc.) |
| 429 | Too Many Requests | Rate limit exceeded |
| 500 | Internal Server Error | Unexpected service error |
| 503 | Service Unavailable | Database down, maintenance mode |

## 6C: Error Mapping

```typescript
// Service errors → HTTP errors
try {
  await claimService.submitClaim(...);
} catch (error) {
  if (error.message === 'VOUCHER_EXPIRED') {
    throw new ApiError(422, 'VOUCHER_EXPIRED', 'Voucher has expired', { voucherId });
  }
  if (error.message === 'CLINIC_NOT_ACTIVE') {
    throw new ApiError(403, 'CLINIC_NOT_ACTIVE', 'Clinic is suspended');
  }
  // ... map all service errors
  throw new ApiError(500, 'INTERNAL_ERROR', 'An unexpected error occurred');
}
```

---

# SECTION 7 — MIDDLEWARE

## 7A: Authentication Middleware

```typescript
export function authenticate(entityType: 'clinic' | 'grantee' | 'admin') {
  return async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: { code: 'MISSING_AUTH', message: 'Authorization header required' } });
    }
    
    const token = authHeader.substring(7);
    
    if (entityType === 'admin') {
      // JWT validation
      const decoded = verifyJWT(token);
      req.auth = { userId: decoded.sub, role: decoded.role, permissions: decoded.permissions };
    } else {
      // API key validation
      const keyHash = crypto.createHash('sha256').update(token).digest('hex');
      const key = await pool.query('SELECT * FROM api_keys WHERE key_hash = $1 AND entity_type = $2', [keyHash, entityType.toUpperCase()]);
      if (!key.rows[0] || key.rows[0].revoked_at || (key.rows[0].expires_at && new Date() > key.rows[0].expires_at)) {
        return res.status(401).json({ error: { code: 'INVALID_API_KEY', message: 'API key is invalid or expired' } });
      }
      req.auth = { entityType, entityId: key.rows[0].entity_id, scopes: key.rows[0].scopes };
    }
    
    next();
  };
}
```

## 7B: Request Validation

```typescript
export function validate(schema: z.ZodSchema) {
  return (req, res, next) => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Request validation failed',
            details: error.errors
          }
        });
      }
      next(error);
    }
  };
}
```

## 7C: Error Handler

```typescript
export function errorHandler(err, req, res, next) {
  console.error('[API Error]', {
    correlationId: req.correlationId,
    path: req.path,
    error: err.message,
    stack: err.stack
  });
  
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
  
  // Never leak internal errors to client
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
      correlationId: req.correlationId
    }
  });
}
```

---

# SECTION 8 — FILES TO CREATE

**New Files:**
```
src/api/server.ts
src/api/middleware/auth.ts
src/api/middleware/error-handler.ts
src/api/middleware/request-logger.ts
src/api/middleware/validator.ts
src/api/routes/clinic-routes.ts
src/api/routes/grantee-routes.ts
src/api/routes/admin-routes.ts
src/api/routes/public-routes.ts
src/api/schemas/clinic-schemas.ts
src/api/schemas/grantee-schemas.ts
src/api/schemas/admin-schemas.ts
src/api/openapi/spec.ts
db/migrations/006_api_keys.sql
```

**Updated Files:**
```
package.json — Add express, zod, helmet, cors, rate-limit
tsconfig.json — Ensure API files are included
```

---

# SECTION 9 — STOP CONDITIONS

If any of the following occur, **STOP and report**:

- Business logic duplicated in routes (validation, calculations, state transitions)
- Service methods bypassed (direct DB access from routes)
- Stack traces exposed to clients
- Auth middleware missing on protected routes
- Idempotency keys not enforced on POST operations
- Error codes not documented in OpenAPI spec
- Missing rate limiting on public endpoints

---

# SECTION 10 — VERIFICATION CHECKLIST

After build, verify:

| Check | Command/Test | Expected |
|-------|--------------|----------|
| Server starts | `pnpm start:api` | Listening on port 4000 |
| Auth rejects invalid key | `curl -H "Authorization: Bearer invalid"` | 401 |
| Clinic can submit claim | POST with valid clinic key | 201 |
| Grantee can issue voucher | POST with valid grantee key | 201 |
| Admin can approve claim | POST with valid JWT | 200 |
| Public voucher lookup | GET /public/vouchers/:code | 200 (no auth) |
| OpenAPI spec loads | GET /api/docs | Swagger UI renders |
| Idempotency works | POST same key twice | 2nd returns existing |
| Error format consistent | Trigger 400/422/500 | All use error contract |
| Build passes | `pnpm build` | Exit 0 |

---

**BEGIN PHASE 5 BUILD.**
