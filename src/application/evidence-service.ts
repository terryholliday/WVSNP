import { Pool } from 'pg';
import { ApplicationService } from './application-service';
import {
  ApplicationId,
  EvidenceRefId
} from '../domain/application/application-types';

export interface UploadGrantRequest {
  applicationId: string;
  actorId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

export interface UploadGrant {
  evidenceRefId: string;
  uploadToken: string;
  uploadUrl: string;
  expiresAt: string;
  maxSizeBytes: number;
  allowedMimeTypes: string[];
}

export interface EvidenceValidationResult {
  isValid: boolean;
  errors: string[];
}

export class EvidenceService {
  constructor(
    private pool: Pool,
    private applicationService: ApplicationService
  ) {}

  /**
   * Requests an upload grant for evidence attachment
   */
  async requestUploadGrant(request: UploadGrantRequest): Promise<UploadGrant> {
    // Verify application ownership and status
    const status = await this.applicationService.getApplicationStatus(
      request.applicationId as ApplicationId,
      request.actorId
    );

    if (status.status === 'SUBMITTED') {
      throw new Error('CANNOT_UPLOAD_TO_SUBMITTED_APPLICATION');
    }

    // Validate file constraints
    const validation = this.validateFileConstraints(request);
    if (!validation.isValid) {
      throw new Error(`FILE_VALIDATION_FAILED: ${validation.errors.join(', ')}`);
    }

    // Generate upload grant
    const evidenceRefId = crypto.randomUUID();
    const uploadToken = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    // TODO: Generate actual pre-signed URL for your storage service
    // For now, return a placeholder structure
    const uploadUrl = this.generateUploadUrl(uploadToken, request.fileName);

    const grant: UploadGrant = {
      evidenceRefId,
      uploadToken,
      uploadUrl,
      expiresAt: expiresAt.toISOString(),
      maxSizeBytes: 10 * 1024 * 1024, // 10MB
      allowedMimeTypes: [
        'application/pdf',
        'image/jpeg',
        'image/png',
        'image/gif',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'text/plain'
      ]
    };

    // Store grant in database for validation later
    await this.storeUploadGrant(grant, request);

    return grant;
  }

  /**
   * Validates an evidence attachment after upload
   */
  async validateEvidenceAttachment(
    applicationId: string,
    evidenceRefId: string,
    uploadToken: string,
    sha256: string
  ): Promise<EvidenceValidationResult> {
    const errors: string[] = [];

    // Verify upload grant exists and is valid
    const grant = await this.getUploadGrant(uploadToken);
    if (!grant) {
      errors.push('Upload token is invalid or expired');
      return { isValid: false, errors };
    }

    if (grant.expiresAt < new Date()) {
      errors.push('Upload token has expired');
      return { isValid: false, errors };
    }

    if (grant.evidenceRefId !== evidenceRefId) {
      errors.push('Evidence ref ID does not match upload grant');
      return { isValid: false, errors };
    }

    // TODO: Verify file exists in storage
    // TODO: Verify file size matches grant
    // TODO: Verify SHA256 matches uploaded file

    // For now, assume validation passes
    if (!this.isValidSha256(sha256)) {
      errors.push('Invalid SHA256 hash format');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Generates a storage key for the evidence file
   */
  generateStorageKey(applicationId: string, evidenceRefId: string, fileName: string): string {
    const extension = this.getFileExtension(fileName);
    return `applications/${applicationId}/evidence/${evidenceRefId}.${extension}`;
  }

  /**
   * Validates file constraints before upload
   */
  private validateFileConstraints(request: UploadGrantRequest): EvidenceValidationResult {
    const errors: string[] = [];

    // File size validation
    if (request.sizeBytes > 10 * 1024 * 1024) { // 10MB
      errors.push('File size exceeds 10MB limit');
    }

    if (request.sizeBytes < 100) { // 100 bytes
      errors.push('File size must be at least 100 bytes');
    }

    // MIME type validation
    const allowedTypes = [
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/gif',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain'
    ];

    if (!allowedTypes.includes(request.mimeType.toLowerCase())) {
      errors.push(`MIME type ${request.mimeType} is not allowed`);
    }

    // File name validation
    if (request.fileName.length > 255) {
      errors.push('File name is too long');
    }

    if (request.fileName.includes('..') || request.fileName.includes('/') || request.fileName.includes('\\')) {
      errors.push('File name contains invalid path characters');
    }

    // Basic sanitization
    if (/[\x00-\x1F\x7F-\x9F]/.test(request.fileName)) {
      errors.push('File name contains invalid characters');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Generates an upload URL (placeholder - integrate with your storage service)
   */
  private generateUploadUrl(uploadToken: string, fileName: string): string {
    // TODO: Integrate with actual storage service (S3, Cloud Storage, etc.)
    // For now, return a placeholder URL structure
    const baseUrl = process.env.STORAGE_BASE_URL || 'https://storage.example.com';
    return `${baseUrl}/upload/${uploadToken}?filename=${encodeURIComponent(fileName)}`;
  }

  /**
   * Stores upload grant in database for validation
   */
  private async storeUploadGrant(grant: UploadGrant, request: UploadGrantRequest): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(`
        INSERT INTO upload_grants (
          upload_token,
          evidence_ref_id,
          application_id,
          actor_id,
          file_name,
          mime_type,
          size_bytes,
          expires_at,
          created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
      `, [
        grant.uploadToken,
        grant.evidenceRefId,
        request.applicationId,
        request.actorId,
        request.fileName,
        request.mimeType,
        request.sizeBytes,
        grant.expiresAt
      ]);
    } finally {
      client.release();
    }
  }

  /**
   * Retrieves upload grant from database
   */
  private async getUploadGrant(uploadToken: string): Promise<any | null> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(`
        SELECT * FROM upload_grants
        WHERE upload_token = $1 AND expires_at > NOW()
      `, [uploadToken]);

      return result.rows[0] || null;
    } finally {
      client.release();
    }
  }

  /**
   * Gets file extension from filename
   */
  private getFileExtension(fileName: string): string {
    const parts = fileName.split('.');
    return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : 'bin';
  }

  /**
   * Validates SHA256 hash format
   */
  private isValidSha256(hash: string): boolean {
    return /^[a-f0-9]{64}$/i.test(hash);
  }

  /**
   * Cleans up expired upload grants (call periodically)
   */
  async cleanupExpiredGrants(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('DELETE FROM upload_grants WHERE expires_at < NOW()');
    } finally {
      client.release();
    }
  }
}
