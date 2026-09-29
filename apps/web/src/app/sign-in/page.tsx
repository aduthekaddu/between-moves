import type { Metadata } from 'next';
import { AuthPage } from '../_auth/auth-page';

export const metadata: Metadata = {
  title: 'Sign in | Between Moves',
  robots: { index: false, follow: false },
};

export default function SignInPage() {
  return <AuthPage mode="sign-in" />;
}
