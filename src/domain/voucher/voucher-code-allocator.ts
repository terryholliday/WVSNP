import { AllocatorId, VoucherId } from '../../domain-types';

export interface AllocatorState {
  allocatorId: AllocatorId;
  nextSequence: number;
  allocatedCodes: Set<string>;
}

export function createInitialAllocatorState(allocatorId: AllocatorId): AllocatorState {
  return {
    allocatorId,
    nextSequence: 1,
    allocatedCodes: new Set(),
  };
}

export function applyAllocatorEvent(state: AllocatorState, event: any): void {
  const { eventType, eventData } = event;

  if (eventType === 'VOUCHER_CODE_ALLOCATOR_INITIALIZED') {
    // No change, already initialized
  }

  if (eventType === 'VOUCHER_CODE_ALLOCATED') {
    const { voucherCode } = eventData;
    state.allocatedCodes.add(voucherCode);
    state.nextSequence += 1;
  }
}

export function checkAllocatorInvariant(state: AllocatorState): void {
  // Ensure sequences are unique, etc.
}

export function generateVoucherCode(grantCycleId: string, countyCode: string, sequence: number, year: string): string {
  return `WVSNP-${countyCode}-${year}-${sequence.toString().padStart(4, '0')}`;
}
