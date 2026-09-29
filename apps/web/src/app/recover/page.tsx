import type { Metadata } from 'next';
import Link from 'next/link';
import { AUTH_ART, AuthShell } from '../_auth/auth-page';
import { RecoveryForm } from '../_auth/recovery-form';

export const metadata: Metadata = {
  title: 'Recover your account | Between Moves',
  robots: { index: false, follow: false },
};

/** [BM-010] Recover an account: one link signs you in here and out everywhere else. */
export default function RecoverPage() {
  return (
    <AuthShell
      eyebrow="Account recovery"
      title="Lock the other doors."
      lede="Lost a phone, or signed in somewhere you shouldn’t have? We’ll email you a recovery link. Opening it signs you in and signs you out everywhere else."
      art={AUTH_ART.recover}
    >
      <section className="auth-card" aria-label="Recover your account">
        <div className="auth-card__body">
          <p className="auth-card__eyebrow">Recovery link</p>
          <h2>Send a spare key.</h2>
          <RecoveryForm />
        </div>
        <div className="auth-card__foot">
          <p>
            Only need to sign in? <Link href="/sign-in">Send a sign-in link</Link> instead.
          </p>
        </div>
      </section>
    </AuthShell>
  );
}
