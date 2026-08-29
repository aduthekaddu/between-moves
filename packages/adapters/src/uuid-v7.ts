const UUID_BYTE_LENGTH = 16;

function hex(byte: number): string {
  return byte.toString(16).padStart(2, '0');
}

/** [BM-007] Generate RFC 9562 UUIDv7 identifiers at the infrastructure boundary. */
export function generateUuidV7(now = Date.now()): string {
  if (!Number.isSafeInteger(now) || now < 0 || now > 0xffffffffffff) {
    throw new RangeError('UUIDv7 timestamp must be a non-negative 48-bit integer');
  }

  const bytes = crypto.getRandomValues(new Uint8Array(UUID_BYTE_LENGTH));
  let timestamp = now;
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = timestamp & 0xff;
    timestamp = Math.floor(timestamp / 256);
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  const value = Array.from(bytes, hex).join('');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}
