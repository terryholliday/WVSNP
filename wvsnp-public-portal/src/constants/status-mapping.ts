// Map internal event types to public-facing status text
export const STATUS_MAPPING = {
  APPLICATION_SUBMITTED: {
    status: 'received',
    displayText: 'Application Received',
    description: 'Your application has been received and is being processed.'
  },
  EVIDENCE_UPLOADED: {
    status: 'evidence_received',
    displayText: 'Evidence Received',
    description: 'Your supporting documents have been received.'
  },
  EVIDENCE_VERIFIED: {
    status: 'evidence_verified',
    displayText: 'Evidence Verified',
    description: 'Your supporting documents have been reviewed and verified.'
  },
  APPLICATION_UNDER_REVIEW: {
    status: 'in_review',
    displayText: 'Under Review',
    description: 'Your application is being reviewed by our team.'
  },
  APPLICATION_APPROVED: {
    status: 'approved',
    displayText: 'Approved — Voucher Being Issued',
    description: 'Your application has been approved. Your voucher is being prepared.'
  },
  VOUCHER_ISSUED: {
    status: 'voucher_issued',
    displayText: 'Voucher Issued (check email for details)',
    description: 'Your voucher has been issued. Please check your email for voucher details and contact your selected veterinarian to schedule your appointment.'
  },
  CLAIM_SUBMITTED: {
    status: 'service_reported',
    displayText: 'Veterinary Service Reported',
    description: 'Your veterinarian has reported completion of the veterinary service.'
  },
  CLAIM_APPROVED: {
    status: 'service_confirmed',
    displayText: 'Service Confirmed — Complete',
    description: 'The veterinary service has been confirmed. Your participation in the WVSNP is complete.'
  },
  APPLICATION_DENIED: {
    status: 'denied',
    displayText: 'Not Approved (see details below)',
    description: 'Unfortunately, your application was not approved at this time.'
  },
  APPLICATION_RETURNED: {
    status: 'returned',
    displayText: 'Action Needed (see details below)',
    description: 'Additional information or action is needed to process your application.'
  }
} as const;

export type PublicStatus = typeof STATUS_MAPPING[keyof typeof STATUS_MAPPING]['status'];
