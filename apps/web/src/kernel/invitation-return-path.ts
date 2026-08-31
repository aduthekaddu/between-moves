const invitationReturnPathPattern = /^\/invitations\/[A-Za-z0-9_-]{43}$/;

/** [BM-016] Accept only the one local deep-link shape that sign-in may preserve. */
export function invitationReturnPath(value: unknown): string | null {
  return typeof value === 'string' && invitationReturnPathPattern.test(value) ? value : null;
}
