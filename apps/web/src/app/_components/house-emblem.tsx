/**
 * [UX-IMG-01] A House's emblem is a rosette cut from black card and held up to the lamp: a
 * scalloped edge, a ring of punched holes, and one chess piece cut out of the middle and backed
 * with coloured tissue. The emblem seed decides the edge, the holes, the piece and the dye, so
 * every House cuts its own mark, and the same House always cuts the same one.
 */

const DYES = ['#e8a21a', '#d2361e', '#7c86d6', '#5fa35a'] as const;
const SCREEN = '#f6e7c8';
const CARD = '#1c130d';

/** Piece silhouettes in a 24 × 24 box, cut as the tissue window. */
const PIECES = [
  // pawn
  'M12 3.2a3.3 3.3 0 1 1 0 6.6 3.3 3.3 0 0 1 0-6.6zM8.4 10.6h7.2v1.9H8.4zM9.6 12.9h4.8c.2 2.6 1.3 4.6 3 6v1.1H6.6v-1.1c1.7-1.4 2.8-3.4 3-6zM5.6 20.4h12.8v1.8H5.6z',
  // rook
  'M6.2 2.8h2.4v2h1.9v-2h3v2h1.9v-2h2.4v5l-2 1.6v8.4l2.2 1.9v1.1H6v-1.1l2.2-1.9V9.4l-2-1.6zM5.2 20.4h13.6v1.8H5.2z',
  // bishop
  'M12 1.8a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zM12 5.2c2.6 1.9 4 4.1 4 6.3 0 1.6-.8 2.8-2 3.5l.9 3.6 2 1.3v.9H7.1v-.9l2-1.3.9-3.6c-1.2-.7-2-1.9-2-3.5 0-2.2 1.4-4.4 4-6.3zm1.6 2.4-3 3.6.8.6 3-3.4zM5.4 20.4h13.2v1.8H5.4z',
  // knight
  'M9.4 2.6l1.2 2c3.9-.2 6.9 2.9 7.1 7.6l.3 6.9H7.4c0-3.2 1.3-4.9 3.4-6.4-1.4.3-2.6.8-3.6 1.8l-2-1.8c1.1-3.2 2.4-5.6 4-7.3zM5.4 20.4h13.2v1.8H5.4z',
  // queen
  'M4.6 5.6 7.2 12l1.4-6.6L12 11.6l3.4-6.2 1.4 6.6 2.6-6.4.9 1.3-2.6 10.2 1.6 1.2v1.3H5.3v-1.3l1.6-1.2L4.3 6.9zM5.4 20.4h13.2v1.8H5.4z',
  // king
  'M11 1.6h2v2.2h2.2v2H13v2.1c3 .7 5 2.6 5 5 0 1.7-1 3.1-2.6 4.1l.8 1.6 1.4 1v1.2H6.4v-1.2l1.4-1 .8-1.6C7 15.9 6 14.5 6 12.8c0-2.4 2-4.3 5-5V5.8H8.8v-2H11zM5.4 20.4h13.2v1.8H5.4z',
] as const;

function hash(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function random(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const C = 32;
const round = (n: number) => Math.round(n * 100) / 100;

/** A scalloped disc: `count` bumps of depth `depth` around radius `r`. */
function scallops(count: number, r: number, depth: number): string {
  const steps = count * 8;
  const points: string[] = [];
  for (let i = 0; i < steps; i += 1) {
    const a = (i / steps) * Math.PI * 2 - Math.PI / 2;
    const bump = Math.abs(Math.sin((i / 8) * Math.PI));
    const radius = r - depth + bump * depth;
    points.push(`${round(C + Math.cos(a) * radius)},${round(C + Math.sin(a) * radius)}`);
  }
  return `M${points.join('L')}Z`;
}

export function HouseEmblem({
  seed,
  label,
  className,
}: {
  readonly seed: string;
  readonly label: string;
  readonly className?: string;
}) {
  const next = random(hash(seed));
  const scallopCount = [0, 8, 10, 12, 14, 16][Math.floor(next() * 6)] ?? 12;
  const piece = PIECES[Math.floor(next() * PIECES.length)] ?? PIECES[0];
  const dye = DYES[Math.floor(next() * DYES.length)] ?? DYES[0];
  const holes = 10 + Math.floor(next() * 4) * 4;
  const holeRadius = 1.05 + next() * 0.5;
  const ring = 21.5 + next() * 2;
  const tilt = next() * Math.PI;
  const innerRing = next() > 0.45;

  const edge =
    scallopCount === 0 ? `M${C},${C - 30}a30,30 0 1 1 -0.01,0Z` : scallops(scallopCount, 30, 2.4);

  return (
    <svg className={className} viewBox="-4 -4 72 72" role="img" aria-label={label}>
      <path d={edge} fill="#000" opacity="0.22" transform="translate(1.5 2.5)" />
      <path d={edge} fill={CARD} />
      {innerRing ? (
        <circle cx={C} cy={C} r={ring - 4.2} fill="none" stroke={SCREEN} strokeWidth="0.7" />
      ) : null}
      {Array.from({ length: holes }, (_, i) => {
        const a = tilt + (i / holes) * Math.PI * 2;
        return (
          <circle
            key={i}
            cx={round(C + Math.cos(a) * ring)}
            cy={round(C + Math.sin(a) * ring)}
            r={round(holeRadius)}
            fill={SCREEN}
          />
        );
      })}
      <circle cx={C} cy={C} r="13.5" fill={dye} opacity="0.2" />
      <path d={piece} fill={dye} transform="translate(19.4 19.4) scale(1.05)" />
    </svg>
  );
}
