import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { InvitationRedemptionView } from './invitation-redemption-view';

const handlers = {
  email: '',
  onEmailChange: vi.fn(),
  onSubmit: vi.fn(),
  onRetry: vi.fn(),
};

describe('InvitationRedemptionView', () => {
  it('[BM-016] [DR-INVITE-09] gives an anonymous invitee one clear email sign-in action', () => {
    const html = renderToStaticMarkup(
      <InvitationRedemptionView state={{ kind: 'sign_in' }} {...handlers} />,
    );

    expect(html).toContain('Come into the House.</h1>');
    expect(html).toContain('type="email"');
    expect(html).toContain('Send me a sign-in link');
    expect(html).toContain('autoComplete="email"');
  });

  it('[BM-016] announces email delivery and redemption progress as status', () => {
    const sent = renderToStaticMarkup(
      <InvitationRedemptionView state={{ kind: 'email_sent' }} {...handlers} />,
    );
    const redeeming = renderToStaticMarkup(
      <InvitationRedemptionView state={{ kind: 'redeeming' }} {...handlers} />,
    );

    expect(sent).toContain('Check your email');
    expect(sent).toContain('role="status"');
    expect(redeeming).toContain('Joining your House');
    expect(redeeming).toContain('role="status"');
  });

  it('[BM-016] [PR-COPY-05] renders the exact full-House outcome', () => {
    const html = renderToStaticMarkup(
      <InvitationRedemptionView state={{ kind: 'house_full' }} {...handlers} />,
    );

    expect(html).toContain('This House is full. No more members can join right now.');
    expect(html).toContain('role="alert"');
  });
});
