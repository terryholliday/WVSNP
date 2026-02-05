import * as crypto from 'crypto';

let lastTimestamp = 0;
let lastSequence = 0;

function nextSequence(timestamp: number): number {
  if (timestamp === lastTimestamp) {
    if (lastSequence === 0x0fff) {
      throw new Error('UUIDV7_SEQUENCE_OVERFLOW');
    }
    lastSequence += 1;
    return lastSequence;
  }
  lastTimestamp = timestamp;
  lastSequence = crypto.randomInt(0x1000);
  return lastSequence;
}

function formatUuid(bytes: Uint8Array): string {
  const hex = Buffer.from(bytes).toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}

export function uuidv7(): string {
  const timestamp = Date.now();
  const sequence = nextSequence(timestamp);

  const bytes = new Uint8Array(16);

  const timestampBig = BigInt(timestamp);
  bytes[0] = Number((timestampBig >> 40n) & 0xffn);
  bytes[1] = Number((timestampBig >> 32n) & 0xffn);
  bytes[2] = Number((timestampBig >> 24n) & 0xffn);
  bytes[3] = Number((timestampBig >> 16n) & 0xffn);
  bytes[4] = Number((timestampBig >> 8n) & 0xffn);
  bytes[5] = Number(timestampBig & 0xffn);

  bytes[6] = 0x70 | ((sequence >>> 8) & 0x0f);
  bytes[7] = sequence & 0xff;

  const random = crypto.randomBytes(8);
  bytes[8] = (random[0] & 0x3f) | 0x80;
  bytes[9] = random[1];
  bytes[10] = random[2];
  bytes[11] = random[3];
  bytes[12] = random[4];
  bytes[13] = random[5];
  bytes[14] = random[6];
  bytes[15] = random[7];

  return formatUuid(bytes);
}
