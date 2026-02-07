// HTTP client for WVSNP Public Portal
// Communicates with /api/v1/public/* endpoints

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000';

// API Response types
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    correlationId?: string;
  };
}

export interface ApplicationStatus {
  applicationId: string;
  status: string;
  submittedAt?: string;
  approvedAt?: string;
  deniedAt?: string;
  voucherCode?: string;
  veterinarianName?: string;
  veterinarianPhone?: string;
  voucherExpiration?: string;
}

export interface StartApplicationRequest {
  commandId: string;
  applicationId: string;
  granteeId: string;
  grantCycleId: string;
  organizationName: string;
  organizationType: string;
  orgId: string;
  actorId: string;
  correlationId: string;
  causationId: string | null;
  occurredAt: string;
}

export interface SubmitApplicationRequest {
  commandId: string;
  applicationId: string;
  requestedAmountCents: number;
  matchCommitmentCents: number;
  sectionsCompleted: string[];
  orgId: string;
  actorId: string;
  correlationId: string;
  causationId: string;
  occurredAt: string;
}

export interface AttachEvidenceRequest {
  commandId: string;
  applicationId: string;
  evidenceRefId: string;
  evidenceType: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  storageKey: string;
  orgId: string;
  actorId: string;
  correlationId: string;
  causationId: string;
  occurredAt: string;
}

export interface UploadGrantRequest {
  applicationId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  actorId: string;
}

export interface UploadGrantResponse {
  uploadUrl: string;
  storageKey: string;
  expiresAt: string;
}

// Main API client class
export class ApiClient {
  private baseUrl: string;
  private maxRetries: number = 3;
  private retryDelay: number = 1000; // 1 second

  constructor(baseUrl = API_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  private async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private async requestWithRetry<T>(
    endpoint: string,
    options: RequestInit = {},
    retryCount: number = 0
  ): Promise<ApiResponse<T>> {
    try {
      return await this.request(endpoint, options);
    } catch (error) {
      if (retryCount < this.maxRetries && this.shouldRetry(error)) {
        await this.delay(this.retryDelay * Math.pow(2, retryCount)); // Exponential backoff
        return this.requestWithRetry(endpoint, options, retryCount + 1);
      }
      throw error;
    }
  }

  private shouldRetry(error: any): boolean {
    // Retry on network errors, 5xx server errors, but not 4xx client errors
    if (error instanceof TypeError && error.message.includes('fetch')) {
      return true; // Network error
    }
    return false; // Don't retry other errors for now
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<ApiResponse<T>> {
    const url = `${this.baseUrl}${endpoint}`;

    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
        },
      });

      const data = await response.json();

      if (!response.ok) {
        return {
          success: false,
          error: {
            code: data.error?.code || 'HTTP_ERROR',
            message: data.error?.message || `HTTP ${response.status}: ${response.statusText}`,
            correlationId: data.error?.correlationId,
          },
        };
      }

      return {
        success: true,
        data,
      };
    } catch (error) {
      // Network or parsing errors
      return {
        success: false,
        error: {
          code: 'NETWORK_ERROR',
          message: error instanceof Error ? error.message : 'Network request failed',
        },
      };
    }
  }

  // Start a new application
  async startApplication(request: StartApplicationRequest): Promise<ApiResponse<{ applicationId: string }>> {
    return this.requestWithRetry('/api/v1/public/applications/start', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  // Submit an application
  async submitApplication(request: SubmitApplicationRequest): Promise<ApiResponse<{ applicationId: string }>> {
    return this.requestWithRetry('/api/v1/public/applications/submit', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  // Attach evidence to an application
  async attachEvidence(request: AttachEvidenceRequest): Promise<ApiResponse<{ evidenceRefId: string }>> {
    return this.requestWithRetry('/api/v1/public/applications/evidence', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  // Get application status
  async getApplicationStatus(applicationId: string, actorId: string): Promise<ApiResponse<ApplicationStatus>> {
    return this.requestWithRetry(`/api/v1/public/applications/${applicationId}/status?actorId=${encodeURIComponent(actorId)}`);
  }

  // Request upload grant for evidence
  async requestUploadGrant(request: UploadGrantRequest): Promise<ApiResponse<UploadGrantResponse>> {
    return this.requestWithRetry(`/api/v1/public/applications/${request.applicationId}/evidence/upload-grant`, {
      method: 'POST',
      body: JSON.stringify({
        fileName: request.fileName,
        mimeType: request.mimeType,
        sizeBytes: request.sizeBytes,
        actorId: request.actorId,
      }),
    });
  }

  // Upload file to pre-signed URL
  async uploadFile(uploadUrl: string, file: File, onProgress?: (progress: number) => void): Promise<boolean> {
    try {
      const response = await fetch(uploadUrl, {
        method: 'PUT',
        body: file,
        headers: {
          'Content-Type': file.type,
        },
      });

      return response.ok;
    } catch (error) {
      console.error('File upload failed:', error);
      return false;
    }
  }
}

// Export singleton instance
export const apiClient = new ApiClient();
