// Client-side Application Reference Code generation
// Format: WVSNP-{4 alphanumeric}-{4 alphanumeric}
// Example: WVSNP-A7K2-M9X4

const CODE_PREFIX = 'WVSNP';
const SEGMENT_LENGTH = 4;
const TOTAL_SEGMENTS = 2;

// Generate a cryptographically secure random alphanumeric character
function randomAlphanumeric(): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // Excluding ambiguous chars: 0/O, 1/I/L
  const randomIndex = crypto.getRandomValues(new Uint32Array(1))[0] % chars.length;
  return chars[randomIndex];
}

// Generate one segment of the reference code
function generateSegment(): string {
  let segment = '';
  for (let i = 0; i < SEGMENT_LENGTH; i++) {
    segment += randomAlphanumeric();
  }
  return segment;
}

// Generate a complete application reference code
export function generateReferenceCode(): string {
  const segments = [];
  for (let i = 0; i < TOTAL_SEGMENTS; i++) {
    segments.push(generateSegment());
  }
  return `${CODE_PREFIX}-${segments.join('-')}`;
}

// Validate reference code format
export function isValidReferenceCode(code: string): boolean {
  const pattern = /^WVSNP-[A-Z0-9]{4}-[A-Z0-9]{4}$/;
  return pattern.test(code);
}

// Extract segments for display or processing
export function parseReferenceCode(code: string): { prefix: string; segment1: string; segment2: string } | null {
  const match = code.match(/^WVSNP-([A-Z0-9]{4})-([A-Z0-9]{4})$/);
  if (!match) return null;

  return {
    prefix: 'WVSNP',
    segment1: match[1],
    segment2: match[2]
  };
}

// Format for display (with spaces for readability)
export function formatReferenceCode(code: string): string {
  return code.replace(/-/g, ' ');
}
