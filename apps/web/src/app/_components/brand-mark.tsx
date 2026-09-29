/**
 * The Between Moves mark: a pawn cut from black card, pressed against a lit screen, with one
 * amber tissue window and the rod that holds it. The smallest piece, and the House's.
 */
export function BrandMark({ className }: { readonly className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect x="1" y="1" width="30" height="30" rx="7" fill="var(--mark-screen, #f4dfb4)" />
      <g fill="var(--mark-ink, #1c130d)">
        <circle cx="16" cy="8.6" r="3.9" />
        <rect x="11" y="13.1" width="10" height="2.6" rx="1.3" />
        <path d="M12.9 15.4h6.2c.2 3.1 1.5 5.4 3.5 7.1v1.1H9.4v-1.1c2-1.7 3.3-4 3.5-7.1z" />
        <rect x="8.2" y="23.2" width="15.6" height="3.1" rx="1.4" />
      </g>
      <circle cx="16" cy="19.6" r="1.55" fill="var(--mark-glow, #e8a21a)" />
      <path
        d="M16 26.3 18.6 31"
        stroke="var(--mark-ink, #1c130d)"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}
