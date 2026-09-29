/**
 * The theatre's cut-paper company, drawn for the lit screen: each sprite's large and small
 * file and its pixel size. Generated from the asset pipeline; do not edit by hand.
 */
export interface SpriteAsset {
  readonly src: string;
  readonly small: string | null;
  readonly w: number;
  readonly h: number;
}

export const SPRITES = {
  knight: {
    src: '/theatre/cast/knight.webp',
    small: '/theatre/cast/knight-s.webp',
    w: 751,
    h: 930,
  },
  king: { src: '/theatre/cast/king.webp', small: '/theatre/cast/king-s.webp', w: 790, h: 1150 },
  queen: { src: '/theatre/cast/queen.webp', small: '/theatre/cast/queen-s.webp', w: 765, h: 1150 },
  rook: { src: '/theatre/cast/rook.webp', small: '/theatre/cast/rook-s.webp', w: 764, h: 1150 },
  bishop: {
    src: '/theatre/cast/bishop.webp',
    small: '/theatre/cast/bishop-s.webp',
    w: 575,
    h: 1150,
  },
  lamplighter: {
    src: '/theatre/cast/lamplighter.webp',
    small: '/theatre/cast/lamplighter-s.webp',
    w: 709,
    h: 1100,
  },
  table: {
    src: '/theatre/house/table.webp',
    small: '/theatre/house/table-s.webp',
    w: 1475,
    h: 1008,
  },
  rooftop: {
    src: '/theatre/house/rooftop.webp',
    small: '/theatre/house/rooftop-s.webp',
    w: 1500,
    h: 692,
  },
  train: {
    src: '/theatre/house/train.webp',
    small: '/theatre/house/train-s.webp',
    w: 1500,
    h: 562,
  },
  night: {
    src: '/theatre/house/night.webp',
    small: '/theatre/house/night-s.webp',
    w: 1300,
    h: 853,
  },
  lunch: {
    src: '/theatre/house/lunch.webp',
    small: '/theatre/house/lunch-s.webp',
    w: 1195,
    h: 970,
  },
  morning: {
    src: '/theatre/house/morning.webp',
    small: '/theatre/house/morning-s.webp',
    w: 1300,
    h: 857,
  },
  lights: {
    src: '/theatre/scenery/lights.webp',
    small: '/theatre/scenery/lights-s.webp',
    w: 1504,
    h: 381,
  },
  skyline: {
    src: '/theatre/scenery/skyline.webp',
    small: '/theatre/scenery/skyline-s.webp',
    w: 1544,
    h: 433,
  },
  procession: {
    src: '/theatre/scenery/procession.webp',
    small: '/theatre/scenery/procession-s.webp',
    w: 1500,
    h: 551,
  },
  door: {
    src: '/theatre/scenery/door.webp',
    small: '/theatre/scenery/door-s.webp',
    w: 685,
    h: 1150,
  },
  book: {
    src: '/theatre/scenery/book.webp',
    small: '/theatre/scenery/book-s.webp',
    w: 1200,
    h: 745,
  },
  clouds: {
    src: '/theatre/scenery/clouds.webp',
    small: '/theatre/scenery/clouds-s.webp',
    w: 1491,
    h: 782,
  },
  pawn1: { src: '/theatre/cast/pawn-1.webp', small: '/theatre/cast/pawn-1-s.webp', w: 448, h: 623 },
  pawn2: { src: '/theatre/cast/pawn-2.webp', small: '/theatre/cast/pawn-2-s.webp', w: 444, h: 621 },
  pawn3: { src: '/theatre/cast/pawn-3.webp', small: '/theatre/cast/pawn-3-s.webp', w: 376, h: 621 },
  pawn4: { src: '/theatre/cast/pawn-4.webp', small: '/theatre/cast/pawn-4-s.webp', w: 384, h: 545 },
  member_braid: { src: '/theatre/members/braid.webp', small: null, w: 267, h: 420 },
  member_headphones: { src: '/theatre/members/headphones.webp', small: null, w: 257, h: 420 },
  member_spectacles: { src: '/theatre/members/spectacles.webp', small: null, w: 291, h: 420 },
  member_scarf: { src: '/theatre/members/scarf.webp', small: null, w: 278, h: 420 },
  member_cap: { src: '/theatre/members/cap.webp', small: null, w: 293, h: 420 },
} as const satisfies Record<string, SpriteAsset>;

export type SpriteKey = keyof typeof SPRITES;
