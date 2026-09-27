/**
 * [BM-049] The way back to the last closed Season's Closing Book once the next Season is under
 * way: its final standings step aside, but the book stays on the House's shelf.
 */
export function PreviousSeason({
  houseId,
  title,
}: {
  readonly houseId: string;
  readonly title: string;
}) {
  return (
    <p className="season-previous">
      <span className="season-previous__label">Last Season</span>
      <a href={`/h/${encodeURIComponent(houseId)}/closing-book`}>Read the {title} Closing Book</a>
    </p>
  );
}
