import 'dotenv/config';
import express from 'express';
import { Pool } from 'pg';
import { EventStore, Watermark, DomainEvent } from './event-store';
import { rebuildAllProjections } from './projections/rebuild';
import { createPublicApplicationRouter } from './api/routes/public-application';
import { createAdminApplicationRouter } from './api/routes/admin-application';

const EVENT_TYPE_REGEX = /^[A-Z0-9_]+$/;

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`MISSING_REQUIRED_FIELD:${field}`);
  }
  return value;
}

function requireObject(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`MISSING_REQUIRED_OBJECT:${field}`);
  }
  return value as Record<string, unknown>;
}

function parseOccurredAt(value: unknown): Date {
  const raw = requireString(value, 'occurredAt');
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('INVALID_OCCURRED_AT');
  }
  return parsed;
}

function assertEventType(eventType: string): void {
  if (!EVENT_TYPE_REGEX.test(eventType)) {
    throw new Error('EVENT_TYPE_INVALID');
  }
}

function parseActorType(value: unknown): DomainEvent['actorType'] {
  const actorType = requireString(value, 'actorType');
  if (actorType !== 'APPLICANT' && actorType !== 'ADMIN' && actorType !== 'SYSTEM') {
    throw new Error('ACTOR_TYPE_INVALID');
  }
  return actorType;
}

function buildEventFromRequest(payload: Record<string, unknown>): Omit<DomainEvent, 'ingestedAt'> {
  if ('ingestedAt' in payload) {
    throw new Error('INGESTED_AT_FORBIDDEN');
  }

  const eventType = requireString(payload.eventType, 'eventType');
  assertEventType(eventType);

  return {
    eventId: requireString(payload.eventId, 'eventId') as DomainEvent['eventId'],
    aggregateType: requireString(payload.aggregateType, 'aggregateType'),
    aggregateId: requireString(payload.aggregateId, 'aggregateId'),
    eventType,
    eventData: requireObject(payload.eventData, 'eventData'),
    occurredAt: parseOccurredAt(payload.occurredAt),
    grantCycleId: requireString(payload.grantCycleId, 'grantCycleId'),
    correlationId: requireString(payload.correlationId, 'correlationId'),
    causationId: payload.causationId === null ? null : requireString(payload.causationId, 'causationId'),
    actorId: requireString(payload.actorId, 'actorId') as DomainEvent['actorId'],
    actorType: parseActorType(payload.actorType),
  };
}

function parseWatermark(input: unknown): Watermark {
  const value = requireObject(input, 'watermark');
  const ingestedAtRaw = requireString(value.ingestedAt, 'watermark.ingestedAt');
  const ingestedAt = new Date(ingestedAtRaw);
  if (Number.isNaN(ingestedAt.getTime())) {
    throw new Error('WATERMARK_INGESTED_AT_INVALID');
  }
  const eventId = requireString(value.eventId, 'watermark.eventId') as Watermark['eventId'];
  return { ingestedAt, eventId };
}

const app = express();
app.use(express.json({ limit: '1mb' }));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});
const store = new EventStore(pool);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Mount public application routes
app.use('/api/v1/public/applications', createPublicApplicationRouter(pool, store));

// Mount admin application routes
app.use('/api/v1/admin/applications', createAdminApplicationRouter(pool));

app.post('/events', async (req, res) => {
  try {
    const payload = requireObject(req.body, 'body');
    const event = buildEventFromRequest(payload);
    const appended = await store.append(event);
    res.status(201).json(appended);
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

app.post('/events/query', async (req, res) => {
  try {
    const payload = requireObject(req.body, 'body');
    const watermark = parseWatermark(payload.watermark);
    const limit = payload.limit === undefined ? 1000 : Number(payload.limit);
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new Error('LIMIT_INVALID');
    }
    const events = await store.fetchSince(watermark, limit);
    res.json({ events });
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

app.post('/events/rebuild', async (_req, res) => {
  try {
    const result = await rebuildAllProjections(pool);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`WVSNP-GMS Phase1 API listening on ${port}`);
});

