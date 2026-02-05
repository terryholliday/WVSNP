-- Phase 1 proof script (manual execution)
-- Requires schema.sql applied and DATABASE_URL configured in client.

-- 1) Append two events (server stamps ingested_at)
INSERT INTO event_log (
  event_id,
  aggregate_type,
  aggregate_id,
  event_type,
  event_data,
  occurred_at,
  grant_cycle_id,
  correlation_id,
  causation_id,
  actor_id,
  actor_type
) VALUES (
  '018f5a9b-0a2b-7c1d-8d3e-0f1234567890',
  'APPLICATION',
  '550e8400-e29b-41d4-a716-446655440000',
  'APPLICATION_STARTED',
  '{"applicationId":"550e8400-e29b-41d4-a716-446655440000","granteeId":"11111111-1111-1111-1111-111111111111","cycleId":"FY2026","startedBy":"22222222-2222-2222-2222-222222222222"}',
  '2026-01-10T12:00:00Z',
  'FY2026',
  '33333333-3333-3333-3333-333333333333',
  NULL,
  '44444444-4444-4444-4444-444444444444',
  'APPLICANT'
);

INSERT INTO event_log (
  event_id,
  aggregate_type,
  aggregate_id,
  event_type,
  event_data,
  occurred_at,
  grant_cycle_id,
  correlation_id,
  causation_id,
  actor_id,
  actor_type
) VALUES (
  '018f5a9b-0a2b-7c1d-8d3e-1a1234567890',
  'APPLICATION',
  '550e8400-e29b-41d4-a716-446655440000',
  'APPLICATION_SECTION_COMPLETED',
  '{"applicationId":"550e8400-e29b-41d4-a716-446655440000","sectionKey":"org","completedAt":"2026-01-10T12:05:00Z"}',
  '2026-01-10T12:05:00Z',
  'FY2026',
  '33333333-3333-3333-3333-333333333333',
  '018f5a9b-0a2b-7c1d-8d3e-0f1234567890',
  '44444444-4444-4444-4444-444444444444',
  'APPLICANT'
);

-- 2) Verify server-stamped ingested_at
SELECT event_id, occurred_at, ingested_at
FROM event_log
ORDER BY ingested_at ASC, event_id ASC;

-- 3) Verify exclusive watermark pagination
-- Replace values with the last row from query above.
SELECT * FROM event_log
WHERE (ingested_at > '2026-01-10T12:00:00Z')
   OR (ingested_at = '2026-01-10T12:00:00Z' AND event_id > '018f5a9b-0a2b-7c1d-8d3e-0f1234567890')
ORDER BY ingested_at ASC, event_id ASC
LIMIT 1000;

-- 4) Run projection rebuild (see src/projections/rebuild.ts)
-- After rebuild, validate projection row exists with rebuild metadata.
SELECT application_id, grantee_id, grant_cycle_id, rebuilt_at, watermark_ingested_at, watermark_event_id
FROM applications_projection;
