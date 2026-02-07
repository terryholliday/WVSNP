import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import { EventStore } from '../../event-store';
import { IdempotencyService } from '../../application/idempotency-service';
import { ApplicationService } from '../../application/application-service';
import { Money } from '../../domain-types';
import {
  ApplicationId,
  GranteeId,
  EvidenceRefId,
  StartApplicationCommand,
  SubmitApplicationCommand,
  AttachEvidenceCommand
} from '../../domain/application/application-types';

// WVSNP Program Org ID (fixed tenant for public applications)
const WVSNP_PROGRAM_ORG_ID = '550e8400-e29b-41d4-a716-446655440000'; // Example UUID

export function createPublicApplicationRouter(pool: Pool, store: EventStore): Router {
  const router = Router();

  // Initialize services
  const idempotency = new IdempotencyService(pool);
  const applicationService = new ApplicationService(pool, store, idempotency);

  /**
   * POST /public/applications/start
   * Starts a new application
   */
  router.post('/start', async (req: Request, res: Response) => {
    try {
      const {
        commandId,
        applicationId,
        granteeId,
        grantCycleId,
        organizationName,
        organizationType,
        correlationId,
        causationId,
        occurredAt,
        actorId // Optional - generate if not provided
      } = req.body as any;

      // Generate actorId if not provided (anonymous applicant)
      const finalActorId = actorId || crypto.randomUUID();

      const command: StartApplicationCommand = {
        commandId,
        applicationId,
        granteeId,
        grantCycleId,
        organizationName,
        organizationType,
        orgId: WVSNP_PROGRAM_ORG_ID,
        actorId: finalActorId,
        correlationId,
        causationId,
        occurredAt: new Date(occurredAt)
      };

      const result = await applicationService.startApplication(command);

      res.status(201).json({
        success: true,
        data: result,
        correlationId: command.correlationId
      });

    } catch (error: any) {
      const statusCode = error.message.includes('VALIDATION_ERROR') ? 400 :
                        error.message === 'OPERATION_IN_PROGRESS' ? 409 :
                        error.message === 'APPLICATION_NOT_FOUND' ? 404 : 500;

      res.status(statusCode).json({
        success: false,
        error: {
          code: error.message,
          message: getErrorMessage(error.message),
          correlationId: req.body.correlationId
        }
      });
    }
  });

  /**
   * POST /public/applications/submit
   * Submits an application for review
   */
  router.post('/submit', async (req: Request, res: Response) => {
    try {
      const {
        commandId,
        applicationId,
        requestedAmountCents,
        matchCommitmentCents,
        sectionsCompleted,
        correlationId,
        causationId,
        occurredAt,
        actorId
      } = req.body as any;

      const command: SubmitApplicationCommand = {
        commandId,
        applicationId: applicationId as ApplicationId,
        requestedAmountCents: Money.fromString(requestedAmountCents),
        matchCommitmentCents: Money.fromString(matchCommitmentCents),
        sectionsCompleted,
        orgId: WVSNP_PROGRAM_ORG_ID,
        actorId,
        correlationId,
        causationId,
        occurredAt: new Date(occurredAt)
      };

      const result = await applicationService.submitApplication(command);

      res.status(200).json({
        success: true,
        data: result,
        correlationId: command.correlationId
      });

    } catch (error: any) {
      const statusCode = error.message.includes('VALIDATION_ERROR') ? 400 :
                        error.message === 'OPERATION_IN_PROGRESS' ? 409 :
                        error.message === 'APPLICATION_CANNOT_BE_SUBMITTED' ? 400 :
                        error.message === 'APPLICATION_NOT_FOUND' ? 404 : 500;

      res.status(statusCode).json({
        success: false,
        error: {
          code: error.message,
          message: getErrorMessage(error.message),
          correlationId: req.body.correlationId
        }
      });
    }
  });

  /**
   * POST /public/applications/:applicationId/evidence
   * Attaches evidence to an application
   */
  router.post('/:applicationId/evidence', async (req: Request, res: Response) => {
    try {
      const { applicationId } = req.params;
      const {
        commandId,
        evidenceRefId,
        evidenceType,
        fileName,
        mimeType,
        sizeBytes,
        sha256,
        storageKey,
        correlationId,
        causationId,
        occurredAt,
        actorId
      } = req.body as any;

      const command: AttachEvidenceCommand = {
        commandId,
        applicationId: applicationId as ApplicationId,
        evidenceRefId: evidenceRefId as EvidenceRefId,
        evidenceType,
        fileName,
        mimeType,
        sizeBytes: parseInt(sizeBytes),
        sha256,
        storageKey,
        orgId: WVSNP_PROGRAM_ORG_ID,
        actorId,
        correlationId,
        causationId,
        occurredAt: new Date(occurredAt)
      };

      const result = await applicationService.attachEvidence(command);

      res.status(201).json({
        success: true,
        data: result,
        correlationId: command.correlationId
      });

    } catch (error: any) {
      const statusCode = error.message.includes('VALIDATION_ERROR') ? 400 :
                        error.message === 'OPERATION_IN_PROGRESS' ? 409 :
                        error.message === 'CANNOT_ATTACH_EVIDENCE_TO_SUBMITTED_APPLICATION' ? 400 :
                        error.message === 'APPLICATION_NOT_FOUND' ? 404 : 500;

      res.status(statusCode).json({
        success: false,
        error: {
          code: error.message,
          message: getErrorMessage(error.message),
          correlationId: req.body.correlationId
        }
      });
    }
  });

  /**
   * GET /public/applications/:applicationId/status
   * Gets application status (read-only, applicant can only see their own)
   */
  router.get('/:applicationId/status', async (req: Request, res: Response) => {
    try {
      const { applicationId } = req.params;
      const { actorId } = req.query;

      if (!actorId || typeof actorId !== 'string') {
        return res.status(400).json({
          success: false,
          error: {
            code: 'MISSING_ACTOR_ID',
            message: 'actorId query parameter is required'
          }
        });
      }

      const status = await applicationService.getApplicationStatus(applicationId as ApplicationId, actorId);

      res.status(200).json({
        success: true,
        data: status
      });

    } catch (error: any) {
      const statusCode = error.message === 'ACCESS_DENIED' ? 403 :
                        error.message === 'APPLICATION_NOT_FOUND' ? 404 : 500;

      res.status(statusCode).json({
        success: false,
        error: {
          code: error.message,
          message: getErrorMessage(error.message)
        }
      });
    }
  });

  /**
   * POST /public/applications/:applicationId/evidence/upload-grant
   * Requests an upload grant for evidence (returns pre-signed upload URL)
   */
  router.post('/:applicationId/evidence/upload-grant', async (req: Request, res: Response) => {
    try {
      const { applicationId } = req.params;
      const { fileName, mimeType, sizeBytes, actorId } = req.body as any;

      // Basic validation
      if (!fileName || !mimeType || !sizeBytes || !actorId) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'MISSING_PARAMETERS',
            message: 'fileName, mimeType, sizeBytes, and actorId are required'
          }
        });
      }

      // Verify application ownership
      const status = await applicationService.getApplicationStatus(applicationId as ApplicationId, actorId);

      if (status.status === 'SUBMITTED') {
        return res.status(400).json({
          success: false,
          error: {
            code: 'CANNOT_UPLOAD_TO_SUBMITTED_APPLICATION',
            message: 'Cannot upload evidence to a submitted application'
          }
        });
      }

      // Generate upload grant
      const evidenceRefId = crypto.randomUUID();
      const uploadToken = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

      // TODO: Generate actual pre-signed URL for storage service
      // For now, return a placeholder structure
      const uploadGrant = {
        evidenceRefId,
        uploadToken,
        uploadUrl: `https://storage.example.com/upload/${uploadToken}`,
        expiresAt: expiresAt.toISOString(),
        maxSizeBytes: 10 * 1024 * 1024, // 10MB
        allowedMimeTypes: ['application/pdf', 'image/jpeg', 'image/png']
      };

      res.status(200).json({
        success: true,
        data: uploadGrant
      });

    } catch (error: any) {
      const statusCode = error.message === 'ACCESS_DENIED' ? 403 :
                        error.message === 'APPLICATION_NOT_FOUND' ? 404 : 500;

      res.status(statusCode).json({
        success: false,
        error: {
          code: error.message,
          message: getErrorMessage(error.message)
        }
      });
    }
  });

  return router;
}

/**
 * Maps error codes to user-friendly messages
 */
function getErrorMessage(errorCode: string): string {
  const messages: Record<string, string> = {
    'VALIDATION_ERROR': 'The request contains invalid data. Please check your input.',
    'OPERATION_IN_PROGRESS': 'This operation is already in progress. Please try again later.',
    'APPLICATION_NOT_FOUND': 'The application was not found.',
    'APPLICATION_CANNOT_BE_SUBMITTED': 'The application cannot be submitted in its current state.',
    'CANNOT_ATTACH_EVIDENCE_TO_SUBMITTED_APPLICATION': 'Cannot attach evidence to a submitted application.',
    'ACCESS_DENIED': 'You do not have permission to access this resource.',
    'CANNOT_UPLOAD_TO_SUBMITTED_APPLICATION': 'Cannot upload evidence to a submitted application.',
    'MISSING_PARAMETERS': 'Required parameters are missing.',
    'MISSING_ACTOR_ID': 'Actor ID is required to access this resource.'
  };

  return messages[errorCode] || 'An unexpected error occurred. Please try again.';
}
