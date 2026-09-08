import { describe, expect, it, vi } from 'vitest';
import { generateClientCommandId } from './client-command-id';

describe('Move client command IDs', () => {
  it('[BM-027] generates time-ordered UUIDv7 identifiers accepted by submitMove', () => {
    vi.stubGlobal('crypto', { getRandomValues: (bytes: Uint8Array) => bytes.fill(0xab) });

    const id = generateClientCommandId(1_756_800_000_000);

    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    vi.unstubAllGlobals();
  });
});
