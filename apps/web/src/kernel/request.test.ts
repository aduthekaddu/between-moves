import { describe, expect, it } from 'vitest';
import { readRequestId } from './request';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function request(requestId?: string): Request {
  return new Request('https://app.example.test/api/example', {
    headers: requestId === undefined ? {} : { 'x-request-id': requestId },
  });
}

describe('request correlation id', () => {
  it('reuses a well-formed caller x-request-id', () => {
    expect(readRequestId(request('req_01:edge-7.a'))).toBe('req_01:edge-7.a');
  });

  it.each([
    ['a missing header', undefined],
    ['unsafe characters', 'forged id <script>'],
    ['an oversized value', 'r'.repeat(129)],
  ])('mints a UUID for %s', (_name, value) => {
    expect(readRequestId(request(value))).toMatch(uuid);
  });
});
