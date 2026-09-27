const tokenPattern = /\/invitations\/([A-Za-z0-9_-]{43})(?:[/?#]|$)/;

/**
 * Pull the invitation path out of whatever someone pasted — a full URL, a path, or a link
 * with tracking junk after it. Only the one deep-link shape the server accepts survives.
 */
export function invitationPathFromLink(value: string): string | null {
  const token = tokenPattern.exec(value.trim())?.[1];
  return token === undefined ? null : `/invitations/${token}`;
}
