import { Pool } from 'pg';
import { EventStore, DomainEvent } from '../event-store';
import { ActorId } from '../domain-types';
import { IdempotencyService } from './idempotency-service';
import {
  ApplicationId,
  GranteeId,
  EvidenceRefId,
  StartApplicationCommand,
  SubmitApplicationCommand,
  AttachEvidenceCommand,
  ApplicationEvent,
  ApplicationStartedEvent,
  ApplicationSubmittedEvent,
  ApplicationEvidenceAttachedEvent,
  FraudSignalDetectedEvent,
  FraudSeverity
} from '../domain/application/application-types';
import {
  createInitialApplicationState,
  applyApplicationEvent,
  checkApplicationInvariant,
  calculateCompleteness,
  canSubmitApplication
} from '../domain/application/application-logic';
import {
  validateStartApplicationCommand,
  validateSubmitApplicationCommand,
  validateAttachEvidenceCommand
} from '../domain/application/application-validators';

export class ApplicationService {
  constructor(
    private pool: Pool,
    private store: EventStore,
    private idempotency: IdempotencyService
  ) {}

  /**
   * Starts a new application
   */
  async startApplication(command: StartApplicationCommand): Promise<{ applicationId: ApplicationId }> {
    // Validate command
    validateStartApplicationCommand(command);

    // Idempotency check
    const idempotencyKey = `start_application_${command.applicationId}`;
    const client = await this.pool.connect();
    try {
      const status = await this.idempotency.checkAndReserve(client, idempotencyKey, 'START_APPLICATION', 'hash', 86400);
      if (status === 'COMPLETED') {
        return { applicationId: command.applicationId };
      }
      if (status === 'PROCESSING') {
        throw new Error('OPERATION_IN_PROGRESS');
      }

      // Emit APPLICATION_STARTED event
      const event: Omit<DomainEvent, 'ingestedAt'> = {
        eventId: EventStore.newEventId(),
        aggregateType: 'APPLICATION',
        aggregateId: command.applicationId,
        eventType: 'APPLICATION_STARTED',
        eventData: {
          granteeId: command.granteeId,
          grantCycleId: command.grantCycleId,
          organizationName: command.organizationName,
          organizationType: command.organizationType
        },
        occurredAt: command.occurredAt,
        grantCycleId: command.grantCycleId,
        correlationId: command.correlationId,
        causationId: command.causationId,
        actorId: command.actorId as ActorId,
        actorType: 'APPLICANT'
      };

      await this.store.append(event);

      // Run fraud detection (advisory)
      await this.detectFraudSignals(command.applicationId, command.grantCycleId, command);

      // Mark idempotency as completed
      await this.idempotency.recordResult(client, idempotencyKey, { applicationId: command.applicationId });

      return { applicationId: command.applicationId };
    } finally {
      client.release();
    }
  }

  /**
   * Submits an application for review
   */
  async submitApplication(command: SubmitApplicationCommand): Promise<{ applicationId: ApplicationId }> {
    // Validate command
    validateSubmitApplicationCommand(command);

    // Idempotency check
    const idempotencyKey = `submit_application_${command.applicationId}`;
    const client = await this.pool.connect();
    try {
      const status = await this.idempotency.checkAndReserve(client, idempotencyKey, 'SUBMIT_APPLICATION', 'hash', 86400);
      if (status === 'COMPLETED') {
        return { applicationId: command.applicationId };
      }
      if (status === 'PROCESSING') {
        throw new Error('OPERATION_IN_PROGRESS');
      }

      // Verify application can be submitted
      const state = await this.getApplicationState(command.applicationId);
      if (!canSubmitApplication(state)) {
        throw new Error('APPLICATION_CANNOT_BE_SUBMITTED');
      }

      // Emit APPLICATION_SUBMITTED event
      const event: Omit<DomainEvent, 'ingestedAt'> = {
        eventId: EventStore.newEventId(),
        aggregateType: 'APPLICATION',
        aggregateId: command.applicationId,
        eventType: 'APPLICATION_SUBMITTED',
        eventData: {
          requestedAmountCents: command.requestedAmountCents.toString(),
          matchCommitmentCents: command.matchCommitmentCents.toString(),
          sectionsCompleted: command.sectionsCompleted
        },
        occurredAt: command.occurredAt,
        grantCycleId: state.grantCycleId, // Use grantCycleId from existing state
        correlationId: command.correlationId,
        causationId: command.causationId,
        actorId: command.actorId as ActorId,
        actorType: 'APPLICANT'
      };

      await this.store.append(event);

      // Mark idempotency as completed
      await this.idempotency.recordResult(client, idempotencyKey, { applicationId: command.applicationId });

      return { applicationId: command.applicationId };
    } finally {
      client.release();
    }
  }

  /**
   * Attaches evidence to an application
   */
  async attachEvidence(command: AttachEvidenceCommand): Promise<{ applicationId: ApplicationId; evidenceRefId: EvidenceRefId }> {
    // Validate command
    validateAttachEvidenceCommand(command);

    // Idempotency check
    const idempotencyKey = `attach_evidence_${command.applicationId}_${command.evidenceRefId}`;
    const client = await this.pool.connect();
    try {
      const status = await this.idempotency.checkAndReserve(client, idempotencyKey, 'ATTACH_EVIDENCE', 'hash', 86400);
      if (status === 'COMPLETED') {
        return { applicationId: command.applicationId, evidenceRefId: command.evidenceRefId };
      }
      if (status === 'PROCESSING') {
        throw new Error('OPERATION_IN_PROGRESS');
      }

      // Verify application exists and is not submitted
      const state = await this.getApplicationState(command.applicationId);
      if (state.status === 'SUBMITTED') {
        throw new Error('CANNOT_ATTACH_EVIDENCE_TO_SUBMITTED_APPLICATION');
      }

      // Emit APPLICATION_EVIDENCE_ATTACHED event
      const event: Omit<DomainEvent, 'ingestedAt'> = {
        eventId: EventStore.newEventId(),
        aggregateType: 'APPLICATION',
        aggregateId: command.applicationId,
        eventType: 'APPLICATION_EVIDENCE_ATTACHED',
        eventData: {
          evidenceRefId: command.evidenceRefId,
          evidenceType: command.evidenceType,
          fileName: command.fileName,
          mimeType: command.mimeType,
          sizeBytes: command.sizeBytes,
          sha256: command.sha256,
          storageKey: command.storageKey
        },
        occurredAt: command.occurredAt,
        grantCycleId: state.grantCycleId,
        correlationId: command.correlationId,
        causationId: command.causationId,
        actorId: command.actorId as ActorId,
        actorType: 'APPLICANT'
      };

      await this.store.append(event);

      // Mark idempotency as completed
      await this.idempotency.recordResult(client, idempotencyKey, {
        applicationId: command.applicationId,
        evidenceRefId: command.evidenceRefId
      });

      return { applicationId: command.applicationId, evidenceRefId: command.evidenceRefId };
    } finally {
      client.release();
    }
  }

  /**
   * Gets current application state by replaying events
   */
  private async getApplicationState(applicationId: ApplicationId) {
    const client = await this.pool.connect();
    try {
      const eventRows = await client.query(`
        SELECT event_type, event_data, occurred_at, ingested_at
        FROM event_log
        WHERE aggregate_id = $1 AND aggregate_type = 'APPLICATION'
        ORDER BY ingested_at ASC, event_id ASC
      `, [applicationId]);

      if (eventRows.rows.length === 0) {
        throw new Error('APPLICATION_NOT_FOUND');
      }

      let state = createInitialApplicationState(applicationId);

      for (const row of eventRows.rows) {
        const event: ApplicationEvent = {
          eventType: row.event_type,
          aggregateId: applicationId,
          aggregateType: 'APPLICATION',
          eventData: row.event_data,
          occurredAt: row.occurred_at,
          grantCycleId: row.event_data.grantCycleId || '', // Will be set by first event
          correlationId: row.event_data.correlationId || '',
          causationId: row.event_data.causationId || null,
          actorId: row.event_data.actorId || '',
          actorType: row.event_data.actorType || 'PUBLIC_APPLICANT'
        };

        state = applyApplicationEvent(state, event);
      }

      // Update completeness percentage
      state.completenessPercent = calculateCompleteness(state.sectionsCompleted);

      // Validate invariants
      checkApplicationInvariant(state);

      return state;
    } finally {
      client.release();
    }
  }

  /**
   * Fraud detection (advisory signals only)
   */
  private async detectFraudSignals(applicationId: ApplicationId, grantCycleId: string, context: any): Promise<void> {
    const client = await this.pool.connect();
    try {
      // Detect duplicate applications from same grantee
      const duplicateCheck = await client.query(`
        SELECT COUNT(*) as count
        FROM applications_projection
        WHERE grantee_id = $1 AND grant_cycle_id = $2 AND status != 'DENIED'
      `, [context.granteeId, grantCycleId]);

      if (parseInt(duplicateCheck.rows[0].count) > 0) {
        await this.emitFraudSignal(applicationId, grantCycleId, {
          signalId: crypto.randomUUID(),
          signalCode: 'DUPLICATE_APPLICATION_SAME_GRANTEE',
          severity: 'HIGH' as FraudSeverity,
          evidence: {
            granteeId: context.granteeId,
            grantCycleId,
            existingApplicationsCount: parseInt(duplicateCheck.rows[0].count)
          },
          recommendedAction: 'Review for duplicate submission from same organization'
        });
      }

      // Detect unusual organization name patterns
      if (context.organizationName && context.organizationName.length < 5) {
        await this.emitFraudSignal(applicationId, grantCycleId, {
          signalId: crypto.randomUUID(),
          signalCode: 'SUSPICIOUSLY_SHORT_ORG_NAME',
          severity: 'MEDIUM' as FraudSeverity,
          evidence: {
            organizationName: context.organizationName,
            length: context.organizationName.length
          },
          recommendedAction: 'Verify organization legitimacy and contact information'
        });
      }

      // More fraud signals can be added here...

    } finally {
      client.release();
    }
  }

  /**
   * Emits a fraud signal event
   */
  private async emitFraudSignal(applicationId: ApplicationId, grantCycleId: string, signal: any): Promise<void> {
    const event: Omit<DomainEvent, 'ingestedAt'> = {
      eventId: EventStore.newEventId(),
      aggregateType: 'APPLICATION',
      aggregateId: applicationId,
      eventType: 'FRAUD_SIGNAL_DETECTED',
      eventData: signal,
      occurredAt: new Date(),
      grantCycleId,
      correlationId: crypto.randomUUID(), // Generate new correlation for system events
      causationId: null,
      actorId: 'SYSTEM' as ActorId,
      actorType: 'SYSTEM'
    };

    await this.store.append(event);
  }

  /**
   * Gets application status for public read access
   */
  async getApplicationStatus(applicationId: ApplicationId, actorId: string): Promise<any> {
    const state = await this.getApplicationState(applicationId);

    // Security: Only allow applicant to read their own application
    if (state.granteeId !== actorId) {
      throw new Error('ACCESS_DENIED');
    }

    return {
      applicationId: state.applicationId,
      status: state.status,
      completenessPercent: state.completenessPercent,
      submittedAt: state.submittedAt,
      priorityScore: state.priorityScore,
      evidenceCount: state.evidenceRefs.length,
      fraudSignalsCount: state.fraudSignals.length,
      criticalFraudSignalsCount: state.fraudSignals.filter(s => s.severity === 'HIGH' || s.severity === 'CRITICAL').length
    };
  }
}
