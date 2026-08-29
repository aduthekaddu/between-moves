export type SignInAttemptOutcome = 'accepted' | 'rejected' | 'error';
export type EmailSendOutcome = 'success' | 'failure';
export type RateLimitSurface = 'signin';

export interface IdentityMetricSnapshot {
  readonly email_send_total: Readonly<Record<EmailSendOutcome, number>>;
  readonly sign_in_attempt_total: Readonly<Record<SignInAttemptOutcome, number>>;
  readonly rate_limit_hit_total: Readonly<Record<RateLimitSurface, number>>;
}

export interface IdentityMetricStubs {
  incrementEmailSend(outcome: EmailSendOutcome): void;
  incrementSignInAttempt(outcome: SignInAttemptOutcome): void;
  incrementRateLimitHit(surface: RateLimitSurface): void;
  snapshot(): IdentityMetricSnapshot;
}

/** [BM-008] [BM-009] In-process metric seam preserving required outcome/surface labels. */
export function createIdentityMetricStubs(): IdentityMetricStubs {
  const email = { success: 0, failure: 0 };
  const signIn = { accepted: 0, rejected: 0, error: 0 };
  const rateLimit = { signin: 0 };

  return {
    incrementEmailSend(outcome) {
      email[outcome] += 1;
    },
    incrementSignInAttempt(outcome) {
      signIn[outcome] += 1;
    },
    incrementRateLimitHit(surface) {
      rateLimit[surface] += 1;
    },
    snapshot() {
      return {
        email_send_total: { ...email },
        sign_in_attempt_total: { ...signIn },
        rate_limit_hit_total: { ...rateLimit },
      };
    },
  };
}
