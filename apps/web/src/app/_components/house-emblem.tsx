/**
 * [UX-IMG-01] A House's emblem is a square of paper with some of its corners folded in,
 * showing the dyed underside. The emblem seed decides which corners fold, how deep, and
 * which of the three dyes the paper was soaked in — so every House folds its own mark.
 */

const DYES = [
  { flap: '#2a3565', shade: '#1b2242', crease: '#11172f' },
  { flap: '#e0492f', shade: '#b8321d', crease: '#7d1d0f' },
  { flap: '#f4a53c', shade: '#d9861c', crease: '#9a5b06' },
] as const;

type Corner = 'nw' | 'ne' | 'se' | 'sw';

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

const S = 64;

/** Corner point, the two points where the fold meets the edges, and the folded tip. */
function fold(corner: Corner, depth: number) {
  switch (corner) {
    case 'nw':
      return { a: [depth, 0], b: [0, depth], tip: [depth, depth] };
    case 'ne':
      return { a: [S - depth, 0], b: [S, depth], tip: [S - depth, depth] };
    case 'se':
      return { a: [S, S - depth], b: [S - depth, S], tip: [S - depth, S - depth] };
    case 'sw':
      return { a: [depth, S], b: [0, S - depth], tip: [depth, S - depth] };
  }
}

const points = (list: readonly (readonly number[])[]) => list.map((p) => p.join(',')).join(' ');

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
  const dye = DYES[Math.floor(next() * DYES.length)] ?? DYES[0];
  const all: Corner[] = ['nw', 'ne', 'se', 'sw'];
  const pattern = Math.floor(next() * 5);
  const corners: Corner[] =
    pattern === 0
      ? all
      : pattern === 1
        ? ['nw', 'se']
        : pattern === 2
          ? ['ne']
          : pattern === 3
            ? all.filter(() => next() > 0.35)
            : ['nw', 'ne'];
  if (corners.length === 0) corners.push('se');
  const blintz = pattern === 0 && next() > 0.5;
  const folds = corners.map((corner) => ({
    corner,
    ...fold(corner, blintz ? S / 2 : Math.round(16 + next() * 16)),
  }));
  const seal = next() > 0.45;
  const sealAt = [18 + next() * 28, 18 + next() * 28];

  // paper outline once every folded corner has been cut back along its crease
  const outline: number[][] = [];
  for (const corner of all) {
    const f = folds.find((item) => item.corner === corner);
    const cornerPoint =
      corner === 'nw' ? [0, 0] : corner === 'ne' ? [S, 0] : corner === 'se' ? [S, S] : [0, S];
    if (f === undefined) {
      outline.push(cornerPoint);
    } else if (corner === 'nw') {
      // walking clockwise we arrive up the left edge, so the left-edge point comes first
      outline.push(f.b, f.a);
    } else {
      outline.push(f.a, f.b);
    }
  }

  return (
    <svg className={className} viewBox="-4 -4 72 72" role="img" aria-label={label}>
      <polygon points={points(outline)} fill="#000" opacity="0.18" transform="translate(1.5 2.5)" />
      <polygon points={points(outline)} fill="#f6efe0" />
      {folds.map((f, i) => (
        <g key={f.corner}>
          <polygon
            points={points([f.a, f.b, f.tip])}
            fill="#000"
            opacity="0.12"
            transform="translate(1 1.5)"
          />
          <polygon points={points([f.a, f.b, f.tip])} fill={i % 2 === 0 ? dye.flap : dye.shade} />
          <line
            x1={f.a[0]}
            y1={f.a[1]}
            x2={f.b[0]}
            y2={f.b[1]}
            stroke={dye.crease}
            strokeWidth="0.8"
            strokeLinecap="round"
          />
        </g>
      ))}
      {seal ? <circle cx={sealAt[0]} cy={sealAt[1]} r="3.2" fill="#e0492f" /> : null}
    </svg>
  );
}
