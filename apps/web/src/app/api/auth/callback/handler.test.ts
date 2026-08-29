import { describe, expect, it, vi } from 'vitest';
import { createMagicLinkCallbackHandler } from './handler';

const callback = 'https://app.example.test/api/auth/callback';

describe('GET /api/auth/callback', () => {
  it('[BM-008] [DR-ID-02] forwards the rotated secure session cookie on valid redemption', async () => {
    const verified = new Response(null, {
      status: 302,
      headers: {
        location: 'https://app.example.test/',
        'set-cookie': '__Secure-between-moves.session_token=new-session; HttpOnly; Secure; SameSite=Lax',
      },
    });
    const verifyMagicLink = vi.fn(async () => verified);
    const handler = createMagicLinkCallbackHandler({ verifyMagicLink });
    const request = new Request(`${callback}?token=valid-token`);

    const response = await handler(request);

    expect(verifyMagicLink).toHaveBeenCalledWith('valid-token', request.headers);
    expect(response.status).toBe(302);
    expect(response.headers.get('set-cookie')).toContain('new-session');
  });

  it('[BM-008] redirects missing, expired, used, and invalid tokens to one generic page', async () => {
    const handler = createMagicLinkCallbackHandler({
      verifyMagicLink: vi.fn(async () =>
        Response.redirect(
          'https://app.example.test/auth/link-invalid?error=INVALID_TOKEN',
          302,
        ),
      ),
    });

    const invalid = await handler(new Request(`${callback}?token=invalid-token`));
    const missing = await handler(new Request(callback));

    expect(invalid.status).toBe(302);
    expect(invalid.headers.get('location')).toBe('https://app.example.test/auth/link-invalid');
    expect(missing.headers.get('location')).toBe('https://app.example.test/auth/link-invalid');
    expect(await invalid.text()).toBe('');
  });
});
