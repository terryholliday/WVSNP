export type ClinicStatus = 'ACTIVE' | 'SUSPENDED' | 'INACTIVE';
export type LicenseStatus = 'VALID' | 'EXPIRED' | 'REVOKED' | 'PENDING';

export interface ClinicState {
  clinicId: string;
  clinicName: string;
  status: ClinicStatus;
  licenseStatus: LicenseStatus;
  licenseNumber: string | null;
  licenseExpiresAt: Date | null;
  oasisVendorCode: string | null;
  paymentInfo: {
    accountName?: string;
    accountNumber?: string;
    routingNumber?: string;
    bankName?: string;
  } | null;
  registeredAt: Date | null;
  suspendedAt: Date | null;
  reinstatedAt: Date | null;
}

export function createInitialClinicState(clinicId: string, clinicName: string): ClinicState {
  return {
    clinicId,
    clinicName,
    status: 'INACTIVE',
    licenseStatus: 'PENDING',
    licenseNumber: null,
    licenseExpiresAt: null,
    oasisVendorCode: null,
    paymentInfo: null,
    registeredAt: null,
    suspendedAt: null,
    reinstatedAt: null,
  };
}

export function applyClinicEvent(state: ClinicState, event: any): void {
  const { eventType, eventData, ingestedAt } = event;

  if (eventType === 'VET_CLINIC_REGISTERED') {
    state.status = 'ACTIVE';
    state.clinicName = eventData.clinicName as string;
    state.registeredAt = ingestedAt;
  }

  if (eventType === 'VET_CLINIC_LICENSE_STATUS_RECORDED') {
    state.licenseStatus = eventData.licenseStatus as LicenseStatus;
    state.licenseNumber = eventData.licenseNumber as string;
    if (eventData.licenseExpiresAt) {
      state.licenseExpiresAt = new Date(eventData.licenseExpiresAt as string);
    }
  }

  if (eventType === 'VET_CLINIC_SUSPENDED') {
    state.status = 'SUSPENDED';
    state.suspendedAt = ingestedAt;
  }

  if (eventType === 'VET_CLINIC_REINSTATED') {
    state.status = 'ACTIVE';
    state.reinstatedAt = ingestedAt;
  }

  if (eventType === 'VET_CLINIC_PAYMENT_INFO_UPDATED') {
    state.paymentInfo = {
      accountName: eventData.accountName as string,
      accountNumber: eventData.accountNumber as string,
      routingNumber: eventData.routingNumber as string,
      bankName: eventData.bankName as string,
    };
  }

  if (eventType === 'VET_CLINIC_OASIS_VENDOR_CODE_ASSIGNED') {
    state.oasisVendorCode = eventData.oasisVendorCode as string;
  }
}

export function checkClinicInvariant(state: ClinicState): void {
  if (state.status === 'ACTIVE' && !state.registeredAt) {
    throw new Error('ACTIVE_WITHOUT_REGISTRATION');
  }
  if (state.status === 'SUSPENDED' && !state.suspendedAt) {
    throw new Error('SUSPENDED_WITHOUT_TIMESTAMP');
  }
}

export function canClinicSubmitClaim(state: ClinicState): { allowed: boolean; reason?: string } {
  // LAW 7.1: Claims require clinic with ACTIVE registration and valid license
  if (state.status !== 'ACTIVE') {
    return { allowed: false, reason: 'CLINIC_NOT_ACTIVE' };
  }
  if (state.licenseStatus !== 'VALID') {
    return { allowed: false, reason: 'LICENSE_NOT_VALID' };
  }
  if (state.licenseExpiresAt && state.licenseExpiresAt < new Date()) {
    return { allowed: false, reason: 'LICENSE_EXPIRED' };
  }
  return { allowed: true };
}
