// SHA-256 hash computation using Web Crypto API
// Used for Chain of Custody protocol on all uploads

/**
 * Compute SHA-256 hash of a file
 */
export async function computeFileHash(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = new Uint8Array(hashBuffer);

  // Convert to hex string
  return Array.from(hashArray)
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Compute SHA-256 hash of a Uint8Array
 */
export async function computeBufferHash(buffer: Uint8Array): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = new Uint8Array(hashBuffer);

  // Convert to hex string
  return Array.from(hashArray)
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Verify that a computed hash matches an expected hash
 */
export function verifyHash(computedHash: string, expectedHash: string): boolean {
  return computedHash.toLowerCase() === expectedHash.toLowerCase();
}

/**
 * Format hash for display (truncated for UI)
 */
export function formatHashForDisplay(hash: string): string {
  if (hash.length <= 16) return hash;
  return `${hash.slice(0, 8)}...${hash.slice(-8)}`;
}

/**
 * Check if Web Crypto API is available
 */
export function isCryptoAvailable(): boolean {
  return typeof crypto !== 'undefined' && typeof crypto.subtle !== 'undefined';
}
