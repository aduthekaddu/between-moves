/**
 * The landing's running order. Each act is a pure function of where the reader is in it and of
 * the clock, returning the puppets on the screen. `s` counts viewport heights: 0 when the act's
 * top reaches the bottom of the viewport, 1 when its first block fills the screen, and
 * `length + 1` when its last block has left the top. Puppets are blocked in fractions of the
 * viewport and handed to the engine in CSS pixels.
 *
 * Puppets move on twos: callers pass a clock quantised to twelve frames a second and the
 * scroll position sampled on the same beat, so even a fast scroll lands in held poses.
 */
import { SPRITES, type SpriteKey } from '../../_theatre/assets';
import type { SpriteDraw } from '../../_theatre/engine';

export type ActId =
  'prelude' | 'week' | 'night' | 'season' | 'stories' | 'company' | 'origin' | 'door';

export interface View {
  readonly w: number;
  readonly h: number;
  /** True when the viewport is taller than it is wide: puppets sit under the words. */
  readonly portrait: boolean;
}

type Rgb = readonly [number, number, number];

export interface Act {
  readonly sprites: readonly SpriteKey[];
  readonly tint: (s: number) => Rgb;
  readonly cues: (s: number, t: number, v: View, intro: number) => SpriteDraw[];
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const smooth = (x: number) => {
  const k = clamp01(x);
  return k * k * (3 - 2 * k);
};
const out3 = (x: number) => 1 - (1 - clamp01(x)) ** 3;
/** Progress of s through [a, b], eased. */
const span = (s: number, a: number, b: number) => smooth((s - a) / (b - a));

const hex = (value: string): Rgb => {
  const n = Number.parseInt(value.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};
const mixRgb = (a: Rgb, b: Rgb, k: number): Rgb => [
  lerp(a[0], b[0], k),
  lerp(a[1], b[1], k),
  lerp(a[2], b[2], k),
];

export const TINT = {
  lamp: hex('#f4dfb4'),
  morning: hex('#f3d7a2'),
  midnight: hex('#cdb9a6'),
  noon: hex('#f6e8c9'),
  dawn: hex('#f2c9a6'),
  dusk: hex('#dfb28a'),
  autumn: hex('#efc79c'),
  paper: hex('#f1e0bd'),
  sepia: hex('#e6d2a9'),
  ember: hex('#e9c188'),
} as const;

/** Deterministic per-puppet jitter for the puppeteer's unsteady hand, new on every frame. */
function boil(seed: number, frame: number, amount = 1): { dx: number; dy: number; dr: number } {
  const r = (n: number) => {
    const x = Math.sin((seed * 12.9898 + frame * 78.233 + n * 37.719) * 43758.5453);
    return x - Math.floor(x) - 0.5;
  };
  return { dx: r(1) * 1.2 * amount, dy: r(2) * 1.0 * amount, dr: r(3) * 0.004 * amount };
}

interface Place {
  readonly key: SpriteKey;
  /** Anchor in viewport fractions (bottom centre by default). */
  readonly x: number;
  readonly y: number;
  /** Height as a fraction of the viewport height… */
  readonly h: number;
  /** …but never wider than this fraction of the viewport width. */
  readonly maxW?: number;
  readonly z?: number;
  readonly rot?: number;
  readonly flip?: boolean;
  readonly alpha?: number;
  readonly ax?: number;
  readonly ay?: number;
  readonly seed?: number;
}

function put(v: View, frame: number, p: Place): SpriteDraw {
  const asset = SPRITES[p.key];
  let h = p.h * v.h;
  if (p.maxW !== undefined) h = Math.min(h, (p.maxW * v.w * asset.h) / asset.w);
  const jitter = boil(p.seed ?? 1, frame, (p.z ?? 0) > 0.3 ? 0.4 : 1);
  return {
    key: p.key,
    x: p.x * v.w + jitter.dx,
    y: p.y * v.h + jitter.dy,
    h,
    z: p.z ?? 0,
    rot: (p.rot ?? 0) + jitter.dr,
    ...(p.flip === undefined ? {} : { flip: p.flip }),
    alpha: clamp01(p.alpha ?? 1),
    ...(p.ax === undefined ? {} : { ax: p.ax }),
    ...(p.ay === undefined ? {} : { ay: p.ay }),
  };
}

/** A puppet pressed in from far behind (k 0 → 1): it shrinks, sharpens and gains colour. */
function pressed(k: number, far = 0.55): { z: number; alpha: number } {
  const e = out3(k);
  return { z: lerp(far, 0, e), alpha: clamp01(k * 1.6) };
}

/** Walk cycle on twos: a lift every other step and a tilt that swaps sides. */
function stride(t: number, stepsPerSecond: number, lift: number, tilt: number, phase = 0) {
  const step = Math.floor(t * stepsPerSecond + phase);
  const up = step % 2 === 0 ? 1 : 0;
  return { dy: -up * lift, rot: (step % 2 === 0 ? 1 : -1) * tilt, step };
}

const frameOf = (t: number) => Math.round(t * 12);

// ————————————————————————————————————————————————————————————————— 0 · Prelude

const prelude: Act = {
  sprites: ['table', 'king', 'knight'],
  tint: () => TINT.lamp,
  cues(s, t, v, intro) {
    const f = frameOf(t);
    const leave = span(s, 1.15, 1.95);
    const arrive = pressed(clamp01((intro - 0.35) / 0.65), 0.45);
    const table: Place = v.portrait
      ? { key: 'table', x: 0.5, y: 0.985, h: 0.4, maxW: 1.02, seed: 3 }
      : { key: 'table', x: 0.72, y: 0.985, h: 0.6, maxW: 0.55, seed: 3 };
    const ghosts = clamp01((intro - 0.15) / 0.8) * (1 - leave);
    return [
      put(v, f, {
        ...table,
        y: table.y + leave * 0.05,
        z: arrive.z + leave * 0.5,
        alpha: arrive.alpha * (1 - leave),
      }),
      put(v, f, {
        key: 'king',
        x: v.portrait ? 0.86 : 0.93,
        y: 1.04,
        h: v.portrait ? 0.62 : 1.02,
        z: 0.5,
        flip: true,
        alpha: 0.9 * ghosts,
        seed: 7,
      }),
      put(v, f, {
        key: 'knight',
        x: v.portrait ? 0.72 : 0.84,
        y: v.portrait ? 0.46 : 0.56,
        h: v.portrait ? 0.3 : 0.5,
        z: 0.68,
        flip: true,
        rot: Math.sin(t * 0.7) * 0.03,
        alpha: 0.42 * ghosts,
        seed: 13,
      }),
    ];
  },
};

// ————————————————————————————————————————————————————————————————— 1 · The week

const WEEK_TINTS = [TINT.morning, TINT.midnight, TINT.noon, TINT.dawn] as const;

const week: Act = {
  sprites: ['train', 'night', 'lunch', 'morning', 'skyline'],
  tint(s) {
    const beat = clamp01((s - 1) / 3) * 3;
    const i = Math.min(2, Math.floor(beat));
    return mixRgb(WEEK_TINTS[i] ?? TINT.noon, WEEK_TINTS[i + 1] ?? TINT.noon, smooth(beat - i));
  },
  cues(s, t, v) {
    const f = frameOf(t);
    const draws: SpriteDraw[] = [];
    const x0 = v.portrait ? 0.5 : 0.69;
    const y0 = v.portrait ? 0.975 : 0.96;
    const h0 = v.portrait ? 0.36 : 0.6;
    const maxW = v.portrait ? 1 : 0.56;
    const visible = (k: number) => span(s, k + 0.2, k + 0.85) * (1 - span(s, k + 1.15, k + 1.8));

    // the city stays behind the whole week, drifting a little as the days pass
    draws.push(
      put(v, f, {
        key: 'skyline',
        x: 0.5 - (s - 2.5) * 0.03,
        y: 1.01,
        h: v.portrait ? 0.14 : 0.26,
        maxW: 1.3,
        z: 0.05,
        alpha: 0.38 * span(s, 0.1, 0.8) * (1 - span(s, 4.2, 4.9)),
        seed: 21,
      }),
    );

    // Monday: the train pulls in from the right and leaves to the left
    const trainIn = span(s, 0.2, 0.95);
    const trainOut = span(s, 1.15, 1.9);
    draws.push(
      put(v, f, {
        key: 'train',
        x: lerp(1.55, x0, trainIn) - trainOut * 1.6,
        y: y0,
        h: v.portrait ? 0.24 : 0.46,
        maxW: v.portrait ? 1.3 : 0.8,
        z: 0,
        rot: Math.sin(t * 9) * 0.002,
        alpha: trainIn > 0 && trainOut < 1 ? 1 : 0,
        seed: 31,
      }),
    );

    // Tuesday night: the bed is pressed in out of the dark
    const night = pressed(span(s, 1.3, 1.95));
    draws.push(
      put(v, f, {
        key: 'night',
        x: x0,
        y: y0,
        h: h0,
        maxW,
        z: night.z + span(s, 2.15, 2.8) * 0.5,
        alpha: night.alpha * visible(1),
        seed: 41,
      }),
    );

    // Thursday lunch: lifted up from below the screen's edge
    const lunchUp = out3(span(s, 2.25, 2.9));
    draws.push(
      put(v, f, {
        key: 'lunch',
        x: x0,
        y: lerp(1.55, y0, lunchUp) + span(s, 3.15, 3.8) * 0.6,
        h: h0,
        maxW,
        z: 0,
        rot: lerp(0.08, 0, lunchUp),
        alpha: visible(2) > 0 ? 1 : 0,
        seed: 51,
      }),
    );

    // Saturday morning: the sun comes up with the balcony
    const dawn = pressed(span(s, 3.3, 3.95), 0.4);
    draws.push(
      put(v, f, {
        key: 'morning',
        x: x0,
        y: y0,
        h: h0,
        maxW,
        z: dawn.z + span(s, 4.15, 4.85) * 0.5,
        alpha: dawn.alpha * (1 - span(s, 4.2, 4.9)),
        seed: 61,
      }),
    );
    return draws;
  },
};

// ————————————————————————————————————————————————————————————————— 2 · The Night

const night: Act = {
  sprites: ['lights', 'rooftop', 'skyline', 'pawn1', 'pawn2', 'pawn3', 'pawn4'],
  tint: (s) => mixRgb(TINT.dusk, TINT.midnight, span(s, 0.5, 2.5) * 0.4),
  cues(s, t, v) {
    const f = frameOf(t);
    const on = span(s, 0.15, 0.85) * (1 - span(s, 2.2, 2.9));
    const draws: SpriteDraw[] = [];
    // the lights are let down from the flies and settle with a swing
    const drop = out3(span(s, 0.2, 0.9));
    // the lights are hauled back up into the flies when the rail card comes on
    const haul = span(s, 1.15, 1.75);
    draws.push(
      put(v, f, {
        key: 'lights',
        x: 0.5,
        y: lerp(-0.45, v.portrait ? 0.6 : 0.1, drop) - haul * 0.34,
        h: v.portrait ? 0.1 : 0.3,
        maxW: 1.08,
        ay: 0,
        rot: Math.sin(t * 1.4) * 0.012 * (1.4 - drop),
        z: 0.02,
        alpha: on,
        seed: 71,
      }),
      put(v, f, {
        key: 'skyline',
        x: 0.5,
        y: 1.02,
        h: v.portrait ? 0.16 : 0.3,
        maxW: 1.35,
        z: 0.05,
        alpha: 0.36 * on,
        seed: 72,
      }),
    );
    const roof = pressed(span(s, 0.35, 1.0));
    const roofAway = span(s, 1.3, 1.9);
    draws.push(
      put(v, f, {
        key: 'rooftop',
        x: v.portrait ? 0.5 : 0.7 + roofAway * 0.1,
        y: 0.985,
        h: v.portrait ? 0.24 : 0.46,
        maxW: v.portrait ? 1.05 : 0.56,
        z: roof.z + roofAway * 0.42,
        alpha: roof.alpha * (1 - span(s, 1.6, 2.2)),
        seed: 73,
      }),
    );
    // the chorus: six pawns kick their way on, jazz hands, and bow off
    const chorusIn = span(s, 1.35, 2.0);
    const bow = span(s, 2.25, 2.55);
    const count = v.portrait ? 4 : 6;
    for (let i = 0; i < count; i += 1) {
      const marching = chorusIn < 1;
      const st = stride(t, 4, 7, 0.03, i % 2);
      const pose: SpriteKey =
        bow > 0.3 ? 'pawn4' : marching ? (st.step % 2 === 0 ? 'pawn1' : 'pawn2') : 'pawn3';
      const home = v.portrait ? 0.14 + i * 0.24 : 0.07 + i * 0.075;
      draws.push(
        put(v, f, {
          key: pose,
          x: lerp(home + 1.0, home, chorusIn),
          y: 0.985 + (marching ? st.dy / v.h : 0),
          h: v.portrait ? 0.15 : 0.25,
          z: 0,
          rot: marching ? st.rot : Math.sin(t * 6 + i) * 0.01,
          alpha: span(s, 1.3, 1.5) * (1 - span(s, 2.45, 2.85)),
          seed: 80 + i,
        }),
      );
    }
    return draws;
  },
};

// ————————————————————————————————————————————————————————————————— 3 · The Season

const PARADE: readonly { key: SpriteKey; flip: boolean; h: number }[] = [
  { key: 'king', flip: true, h: 0.34 },
  { key: 'queen', flip: false, h: 0.36 },
  { key: 'rook', flip: true, h: 0.31 },
  { key: 'bishop', flip: false, h: 0.35 },
  { key: 'knight', flip: true, h: 0.29 },
];

const season: Act = {
  sprites: ['clouds', 'king', 'queen', 'rook', 'bishop', 'knight'],
  tint: (s) => mixRgb(TINT.autumn, TINT.paper, span(s, 1.5, 2.6)),
  cues(s, t, v) {
    const f = frameOf(t);
    const on = span(s, 0.1, 0.7) * (1 - span(s, 2.3, 2.95));
    const draws: SpriteDraw[] = [
      put(v, f, {
        key: 'clouds',
        x: v.portrait ? 0.5 : 0.7 - s * 0.03,
        y: v.portrait ? 0.06 : 0.1,
        ay: 0,
        h: v.portrait ? 0.14 : 0.26,
        maxW: v.portrait ? 1.1 : 0.55,
        z: 0.03,
        alpha: 0.8 * on,
        seed: 90,
      }),
    ];
    // the company processes right to left, a week's walk across the screen
    const march = (s - 0.4) * (v.portrait ? 0.62 : 0.5);
    PARADE.forEach((member, i) => {
      const st = stride(t, 3, 6, 0.035, i);
      draws.push(
        put(v, f, {
          key: member.key,
          x: 1.12 + i * (v.portrait ? 0.3 : 0.15) - march,
          y: 0.99 + st.dy / v.h,
          h: member.h * (v.portrait ? 0.62 : 1),
          z: 0,
          flip: member.flip,
          rot: st.rot,
          alpha: on,
          seed: 100 + i,
        }),
      );
    });
    return draws;
  },
};

// ————————————————————————————————————————————————————————————————— 4 · Stories

const stories: Act = {
  sprites: ['book', 'bishop'],
  tint: () => TINT.paper,
  cues(s, t, v) {
    const f = frameOf(t);
    const book = pressed(span(s, 0.25, 0.9), 0.45);
    const away = span(s, 2.2, 2.9);
    // the bishop sidles in from the wings to look over the puzzle, on the diagonal of course
    const peek = out3(span(s, 1.25, 1.85));
    const st = stride(t, 1.2, 3, 0.015);
    return [
      put(v, f, {
        key: 'book',
        x: v.portrait ? 0.5 : 0.74 - peek * 0.06,
        y: 0.975,
        h: v.portrait ? 0.2 : 0.34,
        maxW: v.portrait ? 0.95 : 0.46,
        z: book.z + away * 0.5,
        alpha: book.alpha * (1 - away),
        seed: 110,
      }),
      put(v, f, {
        key: 'bishop',
        x: lerp(1.22, v.portrait ? 0.82 : 0.9, peek),
        y: 0.99 + lerp(0.08, 0, peek) + st.dy / v.h,
        h: v.portrait ? 0.4 : 0.66,
        z: 0,
        rot: lerp(-0.12, 0, peek) + st.rot,
        alpha: peek > 0 ? 1 - away : 0,
        seed: 111,
      }),
    ];
  },
};

// ————————————————————————————————————————————————————————————————— 5 · The company

const COMPANY: readonly { key: SpriteKey; flip: boolean; h: number }[] = [
  { key: 'king', flip: false, h: 0.8 },
  { key: 'queen', flip: false, h: 0.82 },
  { key: 'rook', flip: false, h: 0.8 },
  { key: 'bishop', flip: false, h: 0.8 },
  { key: 'knight', flip: false, h: 0.76 },
];

const LINEUP: readonly { key: SpriteKey; h: number; flip: boolean }[] = [
  { key: 'king', h: 0.42, flip: false },
  { key: 'queen', h: 0.44, flip: true },
  { key: 'rook', h: 0.37, flip: false },
  { key: 'bishop', h: 0.42, flip: true },
  { key: 'knight', h: 0.33, flip: true },
  { key: 'pawn1', h: 0.28, flip: true },
];

const company: Act = {
  sprites: ['king', 'queen', 'rook', 'bishop', 'knight', 'pawn1', 'pawn2', 'pawn3', 'pawn4'],
  tint: () => TINT.lamp,
  cues(s, t, v) {
    const f = frameOf(t);
    const draws: SpriteDraw[] = [];
    // the curtain call: the whole troupe in a row, each pressed in on its own count
    const lineOut = span(s, 1.15, 1.6);
    LINEUP.forEach((member, i) => {
      const inK = span(s, 0.25 + i * 0.07, 0.7 + i * 0.07);
      if (inK <= 0 || lineOut >= 1) return;
      const idle = stride(t, 1.4, 2, 0.01, i);
      draws.push(
        put(v, f, {
          key: member.key,
          x: v.portrait ? 0.2 + (i % 3) * 0.3 : 0.47 + i * 0.09,
          y: (v.portrait ? (i < 3 ? 0.74 : 0.99) : 0.99) + idle.dy / v.h,
          h: member.h * (v.portrait ? 0.46 : 1),
          z: lerp(0.5, 0, out3(inK)) + lineOut * 0.4,
          flip: member.flip,
          rot: idle.rot,
          alpha: clamp01(inK * 1.6) * (1 - lineOut),
          seed: 160 + i,
        }),
      );
    });
    COMPANY.forEach((member, index) => {
      const k = index + 1;
      const inK = span(s, k + 0.3, k + 0.95);
      const outK = span(s, k + 1.1, k + 1.7);
      if (inK <= 0 || outK >= 1) return;
      const idle = stride(t, 1.5, 3, 0.012, k);
      draws.push(
        put(v, f, {
          key: member.key,
          x: v.portrait ? 0.5 : 0.72,
          y: 0.985 + idle.dy / v.h,
          h: member.h * (v.portrait ? 0.62 : 1),
          maxW: v.portrait ? 0.9 : 0.5,
          z: lerp(0.62, 0, out3(inK)) + outK * 0.6,
          flip: member.flip,
          rot: idle.rot,
          alpha: clamp01(inK * 1.5) * (1 - outK),
          seed: 120 + k,
        }),
      );
    });
    // and eight pawns, who dream of the far rank: a full chorus line
    const k = 6;
    const inK = span(s, k + 0.3, k + 0.9);
    const outK = span(s, k + 1.15, k + 1.75);
    if (inK > 0 && outK < 1) {
      const count = v.portrait ? 4 : 8;
      for (let i = 0; i < count; i += 1) {
        const st = stride(t, 4, 8, 0.04, i % 2);
        const pose: SpriteKey = outK > 0.25 ? 'pawn4' : st.step % 4 < 2 ? 'pawn1' : 'pawn2';
        draws.push(
          put(v, f, {
            key: i % 3 === 2 && outK <= 0.25 && st.step % 8 >= 6 ? 'pawn3' : pose,
            x: v.portrait ? 0.14 + i * 0.24 : 0.47 + i * 0.066,
            y: 0.985 + st.dy / v.h,
            h: v.portrait ? 0.16 : 0.3,
            z: lerp(0.5, 0, out3(inK)),
            rot: st.rot,
            alpha: clamp01(inK * 1.5) * (1 - outK),
            seed: 130 + i,
          }),
        );
      }
    }
    return draws;
  },
};

// ————————————————————————————————————————————————————————————————— 6 · Where it began

const origin: Act = {
  sprites: ['procession'],
  tint: () => TINT.sepia,
  cues(s, t, v) {
    const f = frameOf(t);
    const on = span(s, 0.1, 0.6) * (1 - span(s, 2.2, 2.9));
    const st = stride(t, 2, 4, 0.012);
    return [
      put(v, f, {
        key: 'procession',
        x: lerp(-0.2, 1.05, clamp01((s - 0.2) / 2.6)),
        y: 1.0 + st.dy / v.h,
        h: v.portrait ? 0.2 : 0.34,
        maxW: v.portrait ? 1.4 : 1.0,
        z: 0,
        rot: st.rot,
        alpha: on,
        seed: 140,
      }),
    ];
  },
};

// ————————————————————————————————————————————————————————————————— 7 · The door

const door: Act = {
  sprites: ['door', 'lamplighter'],
  tint: () => TINT.ember,
  cues(s, t, v) {
    const f = frameOf(t);
    const d = pressed(span(s, 0.2, 0.85), 0.45);
    const walk = clamp01((s - 0.35) / 0.8);
    const st = stride(t, 3, 6, 0.03);
    const walking = walk > 0 && walk < 1;
    return [
      put(v, f, {
        key: 'door',
        x: v.portrait ? 0.7 : 0.76,
        y: 0.99,
        h: v.portrait ? 0.46 : 0.8,
        maxW: v.portrait ? 0.56 : 0.4,
        z: d.z,
        alpha: d.alpha,
        seed: 150,
      }),
      put(v, f, {
        key: 'lamplighter',
        x: lerp(-0.12, v.portrait ? 0.3 : 0.56, out3(walk)),
        y: 0.99 + (walking ? st.dy / v.h : 0),
        h: v.portrait ? 0.34 : 0.6,
        z: 0,
        rot: walking ? st.rot : 0,
        alpha: walk > 0 ? 1 : 0,
        seed: 151,
      }),
    ];
  },
};

export const ACTS: Readonly<Record<ActId, Act>> = {
  prelude,
  week,
  night,
  season,
  stories,
  company,
  origin,
  door,
};
