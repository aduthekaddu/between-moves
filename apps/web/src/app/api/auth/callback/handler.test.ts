import { describe, expect, it, vi } from 'vitest';
import { createMagicLinkCallbackHandler } from './handler';

const callback = 'https://app.example.test/api/auth/callback';

function validRequest(): Request {
  return new Request(`${callback}?token=valid-token&proof=signin-proof`);
}

describe('GET /api/auth/callback', () => {
  it('[BM-016] [DR-INVITE-09] returns a signed-in person to the preserved Invitation path', async () => {
    const returnTo = `/invitations/${'A'.repeat(43)}`;
    const verifyMagicLink = vi.fn(async () =>
      Response.redirect(`https://app.example.test${returnTo}`, 302),
    );
    const handler = createMagicLinkCallbackHandler({
      isExpectedPurpose: vi.fn(() => true),
      verifyMagicLink,
    });
    const incoming = new Request(
      `${callback}?token=valid-token&proof=signin-proof&returnTo=${encodeURIComponent(returnTo)}`,
    );

    const response = await handler(incoming);

    expect(verifyMagicLink).toHaveBeenCalledWith('valid-token', incoming.headers, returnTo);
    expect(response.headers.get('location')).toBe(`https://app.example.test${returnTo}`);
  });

  it('[BM-016] drops an external return URL before magic-link verification', async () => {
    const verifyMagicLink = vi.fn(async () => Response.redirect('https://app.example.test/', 302));
    const handler = createMagicLinkCallbackHandler({
      isExpectedPurpose: vi.fn(() => true),
      verifyMagicLink,
    });
    const incoming = new Request(
      `${callback}?token=valid-token&proof=signin-proof&returnTo=${encodeURIComponent('https://evil.example.test/steal')}`,
    );

    await handler(incoming);

    expect(verifyMagicLink).toHaveBeenCalledWith('valid-token', incoming.headers, '/');
  });

  it('[BM-008] [DR-ID-02] forwards the rotated secure session cookie on valid redemption', async () => {
    const verified = new Response(null, {
      status: 302,
      headers: {
        location: 'https://app.example.test/',
        'set-cookie':
          '__Secure-between-moves.session_token=new-session; HttpOnly; Secure; SameSite=Lax',
      },
    });
    const verifyMagicLink = vi.fn(async () => verified);
    const isExpectedPurpose = vi.fn(() => true);
    const handler = createMagicLinkCallbackHandler({ verifyMagicLink, isExpectedPurpose });
    const request = validRequest();

    const response = await handler(request);

    expect(isExpectedPurpose).toHaveBeenCalledWith('valid-token', 'signin-proof');
    expect(verifyMagicLink).toHaveBeenCalledWith('valid-token', request.headers, '/');
    expect(response.status).toBe(302);
    expect(response.headers.get('set-cookie')).toContain('new-session');
  });

  it('[BM-008] redirects missing, expired, used, and invalid tokens to one generic page', async () => {
    const handler = createMagicLinkCallbackHandler({
      isExpectedPurpose: vi.fn(() => true),
      verifyMagicLink: vi.fn(async () =>
        Response.redirect('https://app.example.test/auth/link-invalid?error=INVALID_TOKEN', 302),
      ),
    });

    const invalid = await handler(
      new Request(`${callback}?token=invalid-token&proof=signin-proof`),
    );
    const missing = await handler(new Request(callback));

    expect(invalid.status).toBe(302);
    expect(invalid.headers.get('location')).toBe('https://app.example.test/auth/link-invalid');
    expect(missing.headers.get('location')).toBe('https://app.example.test/auth/link-invalid');
    expect(await invalid.text()).toBe('');
  });

  it('[BM-010] rejects a recovery-purpose token at the normal callback before verification', async () => {
    const verifyMagicLink = vi.fn();
    const handler = createMagicLinkCallbackHandler({
      isExpectedPurpose: vi.fn(() => false),
      verifyMagicLink,
    });

    const response = await handler(
      new Request(`${callback}?token=recovery-token&proof=recovery-proof`),
    );

    expect(response.headers.get('location')).toBe('https://app.example.test/auth/link-invalid');
    expect(verifyMagicLink).not.toHaveBeenCalled();
  });
});
