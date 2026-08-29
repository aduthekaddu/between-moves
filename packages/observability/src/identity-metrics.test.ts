import { describe, expect, it } from 'vitest';
import { createIdentityMetricStubs } from './identity-metrics';

describe('identity metrics', () => {
  it('[BM-008] records sign-in attempts and email sends by outcome', () => {
    const metrics = createIdentityMetricStubs();

    metrics.incrementSignInAttempt('accepted');
    metrics.incrementSignInAttempt('rejected');
    metrics.incrementSignInAttempt('error');
    metrics.incrementEmailSend('success');
    metrics.incrementEmailSend('failure');

    expect(metrics.snapshot()).toEqual({
      sign_in_attempt_total: { accepted: 1, rejected: 1, error: 1 },
      email_send_total: { success: 1, failure: 1 },
    });
  });
});
