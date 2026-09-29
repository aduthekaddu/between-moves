import type { Metadata } from 'next';
import { AuthPage } from '../_auth/auth-page';

export const metadata: Metadata = {
  title: 'Create account | Between Moves',
  robots: { index: false, follow: false },
};

export default function SignUpPage() {
  return <AuthPage mode="sign-up" />;
}
