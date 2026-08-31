'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { z } from 'zod';
import {
  InvitationRedemptionView,
  type InvitationRedemptionViewState,
} from './invitation-redemption-view';

const redemptionSchema = z.object({ houseId: z.uuid(), membershipId: z.uuid() }).strict();
const problemSchema = z.object({ code: z.string() }).passthrough();

export interface InvitationRedemptionClientProps {
  readonly token: string;
  readonly authenticated: boolean;
  readonly validToken: boolean;
}

type RedemptionOutcome =
  | { readonly kind: 'joined'; readonly houseId: string }
  | { readonly kind: 'state'; readonly state: InvitationRedemptionViewState };

async function performRedemption(token: string): Promise<RedemptionOutcome> {
  try {
    const response = await fetch(`/api/invitations/${token}/redeem`, { method: 'POST' });
    const body: unknown = await response.json();
    if (response.ok) {
      const parsed = redemptionSchema.safeParse(body);
      if (!parsed.success) return { kind: 'state', state: { kind: 'redeem_error' } };
      return { kind: 'joined', houseId: parsed.data.houseId };
    }
    const problem = problemSchema.safeParse(body);
    if (problem.success && problem.data.code === 'invite_invalid') {
      return { kind: 'state', state: { kind: 'invalid' } };
    }
    if (problem.success && problem.data.code === 'forbidden') {
      return { kind: 'state', state: { kind: 'house_full' } };
    }
    return { kind: 'state', state: { kind: 'redeem_error' } };
  } catch {
    return { kind: 'state', state: { kind: 'redeem_error' } };
  }
}

function initialState(input: {
  authenticated: boolean;
  validToken: boolean;
}): InvitationRedemptionViewState {
  if (!input.validToken) return { kind: 'invalid' };
  return input.authenticated ? { kind: 'redeeming' } : { kind: 'sign_in' };
}

/** [BM-016] [DR-INVITE-09] Continue sign-in into redemption without mutating on page GET. */
export function InvitationRedemptionClient({
  token,
  authenticated,
  validToken,
}: InvitationRedemptionClientProps) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [state, setState] = useState<InvitationRedemptionViewState>(() =>
    initialState({ authenticated, validToken }),
  );

  useEffect(() => {
    if (!authenticated || !validToken) return;
    let cancelled = false;
    void performRedemption(token).then((outcome) => {
      if (cancelled) return;
      if (outcome.kind === 'joined') router.replace(`/h/${outcome.houseId}`);
      else setState(outcome.state);
    });
    return () => {
      cancelled = true;
    };
  }, [authenticated, router, token, validToken]);

  async function requestSignIn(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setState({ kind: 'sending_link' });
    try {
      const response = await fetch('/api/auth/magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, returnTo: `/invitations/${token}` }),
      });
      setState(response.status === 204 ? { kind: 'email_sent' } : { kind: 'sign_in_error' });
    } catch {
      setState({ kind: 'sign_in_error' });
    }
  }

  async function retryRedemption(): Promise<void> {
    setState({ kind: 'redeeming' });
    const outcome = await performRedemption(token);
    if (outcome.kind === 'joined') router.replace(`/h/${outcome.houseId}`);
    else setState(outcome.state);
  }

  return (
    <InvitationRedemptionView
      state={state}
      email={email}
      onEmailChange={setEmail}
      onSubmit={requestSignIn}
      onRetry={() => void retryRedemption()}
    />
  );
}
