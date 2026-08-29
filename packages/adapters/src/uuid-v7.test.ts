import { describe, expect, it } from 'vitest';
import { generateUuidV7 } from './uuid-v7';

describe('generateUuidV7', () => {
  it('[BM-007] emits an RFC 9562 version 7, variant 10 identifier', () => {
    const id = generateUuidV7(1_725_000_000_000);

    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('[BM-007] rejects timestamps outside the UUIDv7 48-bit range', () => {
    expect(() => generateUuidV7(-1)).toThrow(RangeError);
    expect(() => generateUuidV7(0x1000000000000)).toThrow(RangeError);
  });
});
