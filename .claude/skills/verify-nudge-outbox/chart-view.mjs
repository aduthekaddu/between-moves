const list = (x) =>
  Array.isArray(x)
    ? x
    : Object.keys(x ?? {})
        .sort((a, b) => Number(a) - Number(b))
        .map((k) => x[k]);

export const title = 'Nudge delivery';

export function state(v) {
  const events = list(v.outbox);
  if (events.length === 0) return 'No Nudge queued';
  const e = events[0];
  const emailed = list(v.emails).some((m) => m.event === 1);
  const passed = Object.values(v.worker).some((w) => w.pc === 'passed' && w.event === 1);
  if (e.settled === 'sent') return emailed ? 'Email sent, row settled' : 'No email, row settled';
  if (e.settled === 'failed') return emailed ? 'Email sent, row failed' : 'No email, row failed';
  if (emailed) return 'Email sent, row not settled';
  return passed ? 'Still due at the gate' : 'Queued, no email yet';
}

export function step(action, _from, to) {
  const b = state(to);
  if (action === 'Enqueue') return 'the dispatcher queues the Nudge';
  if (action === 'Gate') return 'the gate finds it still due';
  if (action === 'Call')
    return b.startsWith('Email sent') ? 'Resend accepts the email' : 'Resend fails first';
  if (action === 'Crash') return 'the worker stops';
  if (action === 'ParkAny') return 'the lease ran out on the last attempt';
  if (action === 'Settle') {
    if (b === 'No email, row settled')
      return 'the gate found it no longer due, and the row settles';
    if (b === 'No email, row failed' || b === 'Email sent, row failed')
      return 'the retry window or the attempts run out';
    return 'the outbox marks it sent';
  }
  return action;
}
