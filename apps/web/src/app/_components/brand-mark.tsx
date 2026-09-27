/**
 * The Between Moves mark: a square of paper with one corner folded down, showing its dyed
 * underside. Two sides of one sheet, the way both armies share one board.
 */
export function BrandMark({ className }: { readonly className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <path d="M2 2h17.5L30 12.5V30H2z" fill="var(--mark-paper, #f1e8d6)" />
      <path d="M19.5 2 30 12.5H19.5z" fill="var(--mark-ink, #2a3565)" />
      <path d="M19.5 12.5 30 12.5 29 14H19.5z" fill="rgba(0,0,0,0.18)" />
      <circle cx="9" cy="23" r="2.2" fill="var(--mark-dot, #e0492f)" />
    </svg>
  );
}
