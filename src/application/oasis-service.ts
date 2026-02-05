import { Pool, PoolClient } from 'pg';
import * as crypto from 'crypto';
import { EventStore, DomainEvent } from '../event-store';
import { IdempotencyService } from './idempotency-service';
import { ActorId } from '../domain-types';
import { 
  ExportBatchId, 
  OasisRefId, 
  BatchFingerprint,
  createInitialBatchState, 
  applyBatchEvent, 
  checkBatchInvariant,
  canSubmitBatch,
  canVoidBatch,
  createBatchFingerprint
} from '../domain/oasis/batch-logic';
import { renderOasisFile, InvoiceForExport, BatchMetadata, OASIS_FORMAT_VERSION } from '../domain/oasis/renderer';

export class OasisService {
  constructor(
    private pool: Pool,
    private store: EventStore,
    private idempotency: IdempotencyService
  ) {}

  async generateExportBatch(request: {
    idempotencyKey: string;
    grantCycleId: string;
    periodStart: Date;
    periodEnd: Date;
    watermarkIngestedAt: Date;
    watermarkEventId: string;
    actorId: string;
    actorType: 'ADMIN' | 'SYSTEM';
    correlationId: string;
  }): Promise<{ exportBatchId: ExportBatchId }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const status = await this.idempotency.checkAndReserve(client, request.idempotencyKey, 'GENERATE_EXPORT_BATCH', 'hash', 86400);
      if (status === 'COMPLETED') {
        const result = await client.query('SELECT response_json FROM idempotency_cache WHERE idempotency_key = $1', [request.idempotencyKey]);
        return result.rows[0].response_json;
      }
      if (status === 'PROCESSING') {
        throw new Error('OPERATION_IN_PROGRESS');
      }

      // Check if cycle is closed
      const cycleStatus = await this.getCycleCloseoutStatus(client, request.grantCycleId);
      if (cycleStatus === 'CLOSED') {
        // Still allowed after close per spec
      }

      // Check for existing batch with same parameters (idempotency)
      const existingBatch = await client.query(`
        SELECT export_batch_id
        FROM oasis_export_batches_projection
        WHERE grant_cycle_id = $1
          AND period_start = $2
          AND period_end = $3
          AND watermark_ingested_at = $4
          AND watermark_event_id = $5
      `, [request.grantCycleId, request.periodStart, request.periodEnd, request.watermarkIngestedAt, request.watermarkEventId]);

      if (existingBatch.rows.length > 0) {
        const exportBatchId = existingBatch.rows[0].export_batch_id as ExportBatchId;
        const response = { exportBatchId };
        await this.idempotency.recordResult(client, request.idempotencyKey, response);
        await client.query('COMMIT');
        return response;
      }

      // Select invoices using deterministic watermark tuple
      const invoicesResult = await client.query(`
        SELECT i.invoice_id, i.clinic_id, i.invoice_period_start, i.invoice_period_end,
               i.total_amount_cents, i.watermark_ingested_at, i.watermark_event_id,
               c.oasis_vendor_code
        FROM invoices_projection i
        JOIN vet_clinics_projection c ON c.clinic_id = i.clinic_id
        WHERE i.status = 'SUBMITTED'
          AND i.oasis_export_batch_id IS NULL
          AND c.oasis_vendor_code IS NOT NULL
          AND (
            i.watermark_ingested_at < $1
            OR (i.watermark_ingested_at = $1 AND i.watermark_event_id <= $2)
          )
        ORDER BY
          i.watermark_ingested_at ASC,
          i.watermark_event_id ASC,
          i.invoice_id ASC
        FOR UPDATE
      `, [request.watermarkIngestedAt, request.watermarkEventId]);

      if (invoicesResult.rows.length === 0) {
        throw new Error('NO_INVOICES_ELIGIBLE_FOR_EXPORT');
      }

      const invoiceIds = invoicesResult.rows.map(r => r.invoice_id);
      const batchFingerprint = createBatchFingerprint(
        request.grantCycleId,
        request.periodStart.toISOString().split('T')[0],
        request.periodEnd.toISOString().split('T')[0],
        invoiceIds
      );

      const exportBatchId = crypto.randomUUID() as ExportBatchId;
      const batchCode = `WVSNP-${request.grantCycleId.slice(0, 8)}-${Date.now()}`;

      // Emit OASIS_EXPORT_BATCH_CREATED
      const batchCreatedEvent: Omit<DomainEvent, 'ingestedAt'> = {
        eventId: EventStore.newEventId(),
        aggregateType: 'OASIS_EXPORT_BATCH',
        aggregateId: exportBatchId,
        eventType: 'OASIS_EXPORT_BATCH_CREATED',
        eventData: {
          exportBatchId,
          grantCycleId: request.grantCycleId,
          batchCode,
          periodStart: request.periodStart.toISOString().split('T')[0],
          periodEnd: request.periodEnd.toISOString().split('T')[0],
          watermarkIngestedAt: request.watermarkIngestedAt.toISOString(),
          watermarkEventId: request.watermarkEventId,
          batchFingerprint,
          generatedByActorId: request.actorId,
        },
        occurredAt: new Date(),
        grantCycleId: request.grantCycleId,
        correlationId: request.correlationId,
        causationId: null,
        actorId: request.actorId as ActorId,
        actorType: request.actorType,
      };
      await this.store.append(batchCreatedEvent);

      // Emit OASIS_EXPORT_BATCH_ITEM_ADDED for each invoice
      for (const row of invoicesResult.rows) {
        const itemEvent: Omit<DomainEvent, 'ingestedAt'> = {
          eventId: EventStore.newEventId(),
          aggregateType: 'OASIS_EXPORT_BATCH',
          aggregateId: exportBatchId,
          eventType: 'OASIS_EXPORT_BATCH_ITEM_ADDED',
          eventData: {
            exportBatchId,
            invoiceId: row.invoice_id,
            clinicId: row.clinic_id,
            oasisVendorCode: row.oasis_vendor_code,
            amountCents: row.total_amount_cents.toString(),
            invoicePeriodStart: row.invoice_period_start,
            invoicePeriodEnd: row.invoice_period_end,
          },
          occurredAt: new Date(),
          grantCycleId: request.grantCycleId,
          correlationId: request.correlationId,
          causationId: batchCreatedEvent.eventId,
          actorId: request.actorId as ActorId,
          actorType: request.actorType,
        };
        await this.store.append(itemEvent);
      }

      // Update batch projection
      await this.updateBatchProjection(client, exportBatchId);

      const response = { exportBatchId };
      await this.idempotency.recordResult(client, request.idempotencyKey, response);
      await client.query('COMMIT');
      return response;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async renderExportFile(request: {
    idempotencyKey: string;
    exportBatchId: ExportBatchId;
    actorId: string;
    actorType: 'ADMIN' | 'SYSTEM';
    correlationId: string;
  }): Promise<{ artifactId: string; sha256: string; content: string }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const status = await this.idempotency.checkAndReserve(client, request.idempotencyKey, 'RENDER_EXPORT_FILE', 'hash', 86400);
      if (status === 'COMPLETED') {
        const result = await client.query('SELECT response_json FROM idempotency_cache WHERE idempotency_key = $1', [request.idempotencyKey]);
        return result.rows[0].response_json;
      }
      if (status === 'PROCESSING') {
        throw new Error('OPERATION_IN_PROGRESS');
      }

      // Check if already rendered
      const batchRow = await client.query(
        'SELECT * FROM oasis_export_batches_projection WHERE export_batch_id = $1',
        [request.exportBatchId]
      );
      if (batchRow.rows.length === 0) {
        throw new Error('BATCH_NOT_FOUND');
      }

      const batch = batchRow.rows[0];
      if (batch.status === 'FILE_RENDERED' || batch.status === 'SUBMITTED' || batch.status === 'ACKNOWLEDGED') {
        const response = {
          artifactId: batch.artifact_id,
          sha256: batch.file_sha256,
          content: '', // Would load from artifact store
        };
        await this.idempotency.recordResult(client, request.idempotencyKey, response);
        await client.query('COMMIT');
        return response;
      }

      // Get batch items
      const itemsResult = await client.query(`
        SELECT invoice_id, clinic_id, oasis_vendor_code, amount_cents,
               invoice_period_start, invoice_period_end
        FROM oasis_export_batch_items_projection
        WHERE export_batch_id = $1
        ORDER BY invoice_id
      `, [request.exportBatchId]);

      if (itemsResult.rows.length === 0) {
        throw new Error('BATCH_HAS_NO_ITEMS');
      }

      // Prepare invoices for renderer
      const invoices: InvoiceForExport[] = itemsResult.rows.map(row => ({
        invoiceId: row.invoice_id,
        clinicId: row.clinic_id,
        oasisVendorCode: row.oasis_vendor_code,
        amountCents: BigInt(row.amount_cents),
        invoicePeriodStart: new Date(row.invoice_period_start),
        invoicePeriodEnd: new Date(row.invoice_period_end),
      }));

      const metadata: BatchMetadata = {
        batchCode: batch.batch_code,
        generationDate: new Date(),
        fundCode: 'WVSNP',
        orgCode: 'WVDA',
        objectCode: '5100',
      };

      // Render file (pure function)
      const rendered = renderOasisFile(invoices, metadata);

      // Calculate SHA-256
      const sha256 = crypto.createHash('sha256').update(rendered.content, 'utf8').digest('hex');

      // Generate artifact ID
      const artifactId = crypto.randomUUID();

      // Emit OASIS_EXPORT_FILE_RENDERED
      const fileRenderedEvent: Omit<DomainEvent, 'ingestedAt'> = {
        eventId: EventStore.newEventId(),
        aggregateType: 'OASIS_EXPORT_BATCH',
        aggregateId: request.exportBatchId,
        eventType: 'OASIS_EXPORT_FILE_RENDERED',
        eventData: {
          exportBatchId: request.exportBatchId,
          artifactId,
          fileFormat: 'FIXED_WIDTH',
          formatVersion: OASIS_FORMAT_VERSION,
          sha256,
          contentLength: rendered.content.length,
          recordCount: rendered.recordCount,
          controlTotalCents: rendered.controlTotalCents.toString(),
        },
        occurredAt: new Date(),
        grantCycleId: batch.grant_cycle_id,
        correlationId: request.correlationId,
        causationId: null,
        actorId: request.actorId as ActorId,
        actorType: request.actorType,
      };
      await this.store.append(fileRenderedEvent);

      // Update projection
      await this.updateBatchProjection(client, request.exportBatchId);

      const response = { artifactId, sha256, content: rendered.content };
      await this.idempotency.recordResult(client, request.idempotencyKey, response);
      await client.query('COMMIT');
      return response;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async submitBatch(request: {
    idempotencyKey: string;
    exportBatchId: ExportBatchId;
    submissionMethod: 'MANUAL_UPLOAD' | 'API';
    actorId: string;
    actorType: 'ADMIN' | 'SYSTEM';
    correlationId: string;
  }): Promise<{ status: string }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const status = await this.idempotency.checkAndReserve(client, request.idempotencyKey, 'SUBMIT_BATCH', 'hash', 86400);
      if (status === 'COMPLETED') {
        const result = await client.query('SELECT response_json FROM idempotency_cache WHERE idempotency_key = $1', [request.idempotencyKey]);
        return result.rows[0].response_json;
      }
      if (status === 'PROCESSING') {
        throw new Error('OPERATION_IN_PROGRESS');
      }

      // Rebuild state from events
      const eventRows = await client.query(`
        SELECT event_id, event_type, event_data, ingested_at, grant_cycle_id
        FROM event_log
        WHERE aggregate_id = $1
        ORDER BY ingested_at ASC, event_id ASC
      `, [request.exportBatchId]);

      if (eventRows.rows.length === 0) {
        throw new Error('BATCH_NOT_FOUND');
      }

      const firstEvent = eventRows.rows[0].event_data;
      const state = createInitialBatchState(
        request.exportBatchId,
        firstEvent.grantCycleId as string,
        firstEvent.batchCode as string,
        firstEvent.batchFingerprint as BatchFingerprint,
        new Date(firstEvent.periodStart as string),
        new Date(firstEvent.periodEnd as string),
        new Date(firstEvent.watermarkIngestedAt as string),
        firstEvent.watermarkEventId as string
      );

      for (const row of eventRows.rows) {
        const event = {
          eventType: row.event_type,
          eventData: row.event_data,
          ingestedAt: row.ingested_at,
        };
        applyBatchEvent(state, event);
      }
      checkBatchInvariant(state);

      const canSubmit = canSubmitBatch(state);
      if (!canSubmit.allowed) {
        throw new Error(canSubmit.reason);
      }

      // Check if already submitted
      if (state.status === 'SUBMITTED' || state.status === 'ACKNOWLEDGED') {
        const response = { status: state.status };
        await this.idempotency.recordResult(client, request.idempotencyKey, response);
        await client.query('COMMIT');
        return response;
      }

      // Emit OASIS_EXPORT_BATCH_SUBMITTED
      const submittedEvent: Omit<DomainEvent, 'ingestedAt'> = {
        eventId: EventStore.newEventId(),
        aggregateType: 'OASIS_EXPORT_BATCH',
        aggregateId: request.exportBatchId,
        eventType: 'OASIS_EXPORT_BATCH_SUBMITTED',
        eventData: {
          exportBatchId: request.exportBatchId,
          submissionMethod: request.submissionMethod,
          submittedByActorId: request.actorId,
        },
        occurredAt: new Date(),
        grantCycleId: eventRows.rows[0].grant_cycle_id,
        correlationId: request.correlationId,
        causationId: null,
        actorId: request.actorId as ActorId,
        actorType: request.actorType,
      };
      await this.store.append(submittedEvent);

      // Update projection
      await this.updateBatchProjection(client, request.exportBatchId);

      const response = { status: 'SUBMITTED' };
      await this.idempotency.recordResult(client, request.idempotencyKey, response);
      await client.query('COMMIT');
      return response;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async acknowledgeBatch(request: {
    idempotencyKey: string;
    exportBatchId: ExportBatchId;
    oasisRefId: OasisRefId;
    acceptedAt: Date;
    notes?: string;
    actorId: string;
    actorType: 'ADMIN' | 'SYSTEM';
    correlationId: string;
  }): Promise<{ status: string }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const status = await this.idempotency.checkAndReserve(client, request.idempotencyKey, 'ACKNOWLEDGE_BATCH', 'hash', 86400);
      if (status === 'COMPLETED') {
        const result = await client.query('SELECT response_json FROM idempotency_cache WHERE idempotency_key = $1', [request.idempotencyKey]);
        return result.rows[0].response_json;
      }

      const batchRow = await client.query(
        'SELECT grant_cycle_id FROM oasis_export_batches_projection WHERE export_batch_id = $1',
        [request.exportBatchId]
      );
      if (batchRow.rows.length === 0) {
        throw new Error('BATCH_NOT_FOUND');
      }

      const acknowledgedEvent: Omit<DomainEvent, 'ingestedAt'> = {
        eventId: EventStore.newEventId(),
        aggregateType: 'OASIS_EXPORT_BATCH',
        aggregateId: request.exportBatchId,
        eventType: 'OASIS_EXPORT_BATCH_ACKNOWLEDGED',
        eventData: {
          exportBatchId: request.exportBatchId,
          oasisRefId: request.oasisRefId,
          acceptedAt: request.acceptedAt.toISOString(),
          notes: request.notes,
        },
        occurredAt: new Date(),
        grantCycleId: batchRow.rows[0].grant_cycle_id,
        correlationId: request.correlationId,
        causationId: null,
        actorId: request.actorId as ActorId,
        actorType: request.actorType,
      };
      await this.store.append(acknowledgedEvent);

      await this.updateBatchProjection(client, request.exportBatchId);

      const response = { status: 'ACKNOWLEDGED' };
      await this.idempotency.recordResult(client, request.idempotencyKey, response);
      await client.query('COMMIT');
      return response;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async rejectBatch(request: {
    idempotencyKey: string;
    exportBatchId: ExportBatchId;
    rejectionReason: string;
    rejectionCode?: string;
    actorId: string;
    actorType: 'ADMIN' | 'SYSTEM';
    correlationId: string;
  }): Promise<{ status: string }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const status = await this.idempotency.checkAndReserve(client, request.idempotencyKey, 'REJECT_BATCH', 'hash', 86400);
      if (status === 'COMPLETED') {
        const result = await client.query('SELECT response_json FROM idempotency_cache WHERE idempotency_key = $1', [request.idempotencyKey]);
        return result.rows[0].response_json;
      }

      const batchRow = await client.query(
        'SELECT grant_cycle_id FROM oasis_export_batches_projection WHERE export_batch_id = $1',
        [request.exportBatchId]
      );
      if (batchRow.rows.length === 0) {
        throw new Error('BATCH_NOT_FOUND');
      }

      const rejectedEvent: Omit<DomainEvent, 'ingestedAt'> = {
        eventId: EventStore.newEventId(),
        aggregateType: 'OASIS_EXPORT_BATCH',
        aggregateId: request.exportBatchId,
        eventType: 'OASIS_EXPORT_BATCH_REJECTED',
        eventData: {
          exportBatchId: request.exportBatchId,
          rejectionReason: request.rejectionReason,
          rejectionCode: request.rejectionCode,
          rejectedBySource: 'TREASURY',
        },
        occurredAt: new Date(),
        grantCycleId: batchRow.rows[0].grant_cycle_id,
        correlationId: request.correlationId,
        causationId: null,
        actorId: request.actorId as ActorId,
        actorType: request.actorType,
      };
      await this.store.append(rejectedEvent);

      await this.updateBatchProjection(client, request.exportBatchId);

      const response = { status: 'REJECTED' };
      await this.idempotency.recordResult(client, request.idempotencyKey, response);
      await client.query('COMMIT');
      return response;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async voidBatch(request: {
    idempotencyKey: string;
    exportBatchId: ExportBatchId;
    reason: string;
    actorId: string;
    actorType: 'ADMIN' | 'SYSTEM';
    correlationId: string;
  }): Promise<{ status: string }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const status = await this.idempotency.checkAndReserve(client, request.idempotencyKey, 'VOID_BATCH', 'hash', 86400);
      if (status === 'COMPLETED') {
        const result = await client.query('SELECT response_json FROM idempotency_cache WHERE idempotency_key = $1', [request.idempotencyKey]);
        return result.rows[0].response_json;
      }

      // Rebuild state to check if void is allowed
      const eventRows = await client.query(`
        SELECT event_id, event_type, event_data, ingested_at, grant_cycle_id
        FROM event_log
        WHERE aggregate_id = $1
        ORDER BY ingested_at ASC, event_id ASC
      `, [request.exportBatchId]);

      if (eventRows.rows.length === 0) {
        throw new Error('BATCH_NOT_FOUND');
      }

      const firstEvent = eventRows.rows[0].event_data;
      const state = createInitialBatchState(
        request.exportBatchId,
        firstEvent.grantCycleId as string,
        firstEvent.batchCode as string,
        firstEvent.batchFingerprint as BatchFingerprint,
        new Date(firstEvent.periodStart as string),
        new Date(firstEvent.periodEnd as string),
        new Date(firstEvent.watermarkIngestedAt as string),
        firstEvent.watermarkEventId as string
      );

      for (const row of eventRows.rows) {
        const event = {
          eventType: row.event_type,
          eventData: row.event_data,
          ingestedAt: row.ingested_at,
        };
        applyBatchEvent(state, event);
      }

      const canVoid = canVoidBatch(state);
      if (!canVoid.allowed) {
        throw new Error(canVoid.reason);
      }

      const voidedEvent: Omit<DomainEvent, 'ingestedAt'> = {
        eventId: EventStore.newEventId(),
        aggregateType: 'OASIS_EXPORT_BATCH',
        aggregateId: request.exportBatchId,
        eventType: 'OASIS_EXPORT_BATCH_VOIDED',
        eventData: {
          exportBatchId: request.exportBatchId,
          reason: request.reason,
          voidedByActorId: request.actorId,
        },
        occurredAt: new Date(),
        grantCycleId: eventRows.rows[0].grant_cycle_id,
        correlationId: request.correlationId,
        causationId: null,
        actorId: request.actorId as ActorId,
        actorType: request.actorType,
      };
      await this.store.append(voidedEvent);

      await this.updateBatchProjection(client, request.exportBatchId);

      const response = { status: 'VOIDED' };
      await this.idempotency.recordResult(client, request.idempotencyKey, response);
      await client.query('COMMIT');
      return response;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async updateBatchProjection(client: PoolClient, exportBatchId: ExportBatchId): Promise<void> {
    const eventRows = await client.query(`
      SELECT event_id, event_type, event_data, ingested_at
      FROM event_log
      WHERE aggregate_id = $1
      ORDER BY ingested_at ASC, event_id ASC
    `, [exportBatchId]);

    if (eventRows.rows.length === 0) return;

    const firstEvent = eventRows.rows[0].event_data;
    const state = createInitialBatchState(
      exportBatchId,
      firstEvent.grantCycleId as string,
      firstEvent.batchCode as string,
      firstEvent.batchFingerprint as BatchFingerprint,
      new Date(firstEvent.periodStart as string),
      new Date(firstEvent.periodEnd as string),
      new Date(firstEvent.watermarkIngestedAt as string),
      firstEvent.watermarkEventId as string
    );

    for (const row of eventRows.rows) {
      const event = {
        eventType: row.event_type,
        eventData: row.event_data,
        ingestedAt: row.ingested_at,
      };
      applyBatchEvent(state, event);
    }
    checkBatchInvariant(state);

    await client.query(`
      INSERT INTO oasis_export_batches_projection (
        export_batch_id, grant_cycle_id, batch_code, batch_fingerprint,
        period_start, period_end, watermark_ingested_at, watermark_event_id,
        status, record_count, control_total_cents, artifact_id, file_sha256, format_version,
        submitted_at, submission_method, oasis_ref_id, acknowledged_at,
        rejection_reason, rejection_code, voided_reason, voided_by_actor_id,
        rebuilt_at, watermark_ingested_at_row, watermark_event_id_row
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25)
      ON CONFLICT (export_batch_id) DO UPDATE SET
        status = EXCLUDED.status,
        record_count = EXCLUDED.record_count,
        control_total_cents = EXCLUDED.control_total_cents,
        artifact_id = EXCLUDED.artifact_id,
        file_sha256 = EXCLUDED.file_sha256,
        format_version = EXCLUDED.format_version,
        submitted_at = EXCLUDED.submitted_at,
        submission_method = EXCLUDED.submission_method,
        oasis_ref_id = EXCLUDED.oasis_ref_id,
        acknowledged_at = EXCLUDED.acknowledged_at,
        rejection_reason = EXCLUDED.rejection_reason,
        rejection_code = EXCLUDED.rejection_code,
        voided_reason = EXCLUDED.voided_reason,
        voided_by_actor_id = EXCLUDED.voided_by_actor_id,
        rebuilt_at = EXCLUDED.rebuilt_at,
        watermark_ingested_at_row = EXCLUDED.watermark_ingested_at_row,
        watermark_event_id_row = EXCLUDED.watermark_event_id_row
    `, [
      state.exportBatchId, state.grantCycleId, state.batchCode, state.batchFingerprint,
      state.periodStart, state.periodEnd, state.watermarkIngestedAt, state.watermarkEventId,
      state.status, state.recordCount, state.controlTotalCents.toString(), state.artifactId, state.fileSha256, state.formatVersion,
      state.submittedAt, state.submissionMethod, state.oasisRefId, state.acknowledgedAt,
      state.rejectionReason, state.rejectionCode, state.voidedReason, state.voidedByActorId,
      new Date(), eventRows.rows[eventRows.rows.length - 1]?.ingested_at || new Date(), eventRows.rows[eventRows.rows.length - 1]?.event_id || 'dummy'
    ]);

    // Update batch items
    await client.query('DELETE FROM oasis_export_batch_items_projection WHERE export_batch_id = $1', [exportBatchId]);
    
    const itemEvents = eventRows.rows.filter(r => r.event_type === 'OASIS_EXPORT_BATCH_ITEM_ADDED');
    for (const itemEvent of itemEvents) {
      const data = itemEvent.event_data;
      await client.query(`
        INSERT INTO oasis_export_batch_items_projection (
          export_batch_id, invoice_id, clinic_id, oasis_vendor_code,
          amount_cents, invoice_period_start, invoice_period_end
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (export_batch_id, invoice_id) DO NOTHING
      `, [
        exportBatchId, data.invoiceId, data.clinicId, data.oasisVendorCode,
        data.amountCents, data.invoicePeriodStart, data.invoicePeriodEnd
      ]);
    }

    // Update invoices_projection: set oasis_export_batch_id or clear if REJECTED/VOIDED
    if (state.status === 'REJECTED' || state.status === 'VOIDED') {
      await client.query(`
        UPDATE invoices_projection
        SET oasis_export_batch_id = NULL
        WHERE oasis_export_batch_id = $1
      `, [exportBatchId]);
    } else if (state.status !== 'CREATED') {
      const invoiceIds = itemEvents.map(e => e.event_data.invoiceId);
      if (invoiceIds.length > 0) {
        await client.query(`
          UPDATE invoices_projection
          SET oasis_export_batch_id = $1
          WHERE invoice_id = ANY($2::uuid[])
        `, [exportBatchId, invoiceIds]);
      }
    }
  }

  private async getCycleCloseoutStatus(client: PoolClient, grantCycleId: string): Promise<string | null> {
    const result = await client.query(
      'SELECT closeout_status FROM grant_cycle_closeout_projection WHERE grant_cycle_id = $1',
      [grantCycleId]
    );
    return result.rows.length > 0 ? result.rows[0].closeout_status : null;
  }
}
