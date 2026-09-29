/** Landing-page copy and specimens. House vocabulary stays aligned with the product. */

/**
 * One correspondence game across a week and an ocean: Maya in Lisbon (UTC+1), Theo in Toronto
 * (UTC−4). Gaps are measured between the two local times, so they include the five hours.
 */
export const WEEK = [
  {
    scene: 'train',
    postmark: ['Lisbon', 'Mon', '08:12'],
    move: '14. d5',
    who: 'Maya',
    line: 'Maya pushes a pawn somewhere between two stations.',
    gap: null,
  },
  {
    scene: 'night',
    postmark: ['Toronto', 'Tue', '23:40'],
    move: '14… exd5',
    who: 'Theo',
    line: 'Theo answers at 11:40 pm. The cat was asleep. Theo was not.',
    gap: '44 h',
  },
  {
    scene: 'lunch',
    postmark: ['Lisbon', 'Thu', '13:05'],
    move: '15. Bxh7+',
    who: 'Maya',
    line: 'Maya finds the sacrifice between a sandwich and a deadline.',
    gap: '32 h',
  },
  {
    scene: 'morning',
    postmark: ['Toronto', 'Sat', '07:30'],
    move: '15… Kxh7',
    who: 'Theo',
    line: 'Theo takes the bishop before his first coffee, with an hour to spare.',
    gap: '47 h',
  },
] as const;

export const RAIL_CHAT = [
  { who: 'Kenji', body: 'that bishop is just hanging??' },
  { who: 'Priya', body: 'it’s bait. watch.' },
  { who: 'Lucía', body: 'coffee’s getting cold, someone move' },
  { who: 'Amara', body: 'Check.' },
  { who: 'Sam', body: 'rematch next Thursday. same table.' },
] as const;

export const RAIL_PRESENCE = [
  { name: 'Priya', silhouette: 'braid' },
  { name: 'Kenji', silhouette: 'headphones' },
  { name: 'Jonas', silhouette: 'spectacles' },
  { name: 'Lucía', silhouette: 'scarf' },
  { name: 'Sam', silhouette: 'cap' },
] as const;

export const STANDINGS = [
  { rank: 1, name: 'Priya', points: 19 },
  { rank: 2, name: 'Theo', points: 17 },
  { rank: 2, name: 'Maya', points: 17 },
  { rank: 4, name: 'Kenji', points: 12 },
  { rank: 5, name: 'Lucía', points: 9 },
] as const;

/** A back-rank finish from one of the House's own games. */
export const PUZZLE = {
  fen: '6k1/5ppp/8/8/8/8/2r2PPP/3R2K1 w - - 0 1',
  from: 'd1',
  to: 'd8',
  source: 'Sam v Amara · move 31',
  prompt: 'White to play. Amara missed it. Will you?',
  solved: 'Rd8#. The back rank was never safe. Amara has been informed.',
} as const;

/** The company: the six pieces, and the jobs they had when the game began. */
export const COMPANY = [
  {
    kind: 'king',
    name: 'The King',
    once: 'Raja, the king',
    note: 'One square at a time. The whole House exists to keep him there.',
  },
  {
    kind: 'queen',
    name: 'The Queen',
    once: 'Mantri, the counsellor',
    note: 'Began as the king’s adviser, one careful step at a time. Now nothing moves further.',
  },
  {
    kind: 'rook',
    name: 'The Rook',
    once: 'Ratha, the chariot',
    note: 'Straight lines, open files, no patience at all.',
  },
  {
    kind: 'bishop',
    name: 'The Bishop',
    once: 'Gaja, the elephant',
    note: 'Still takes the long way round, on the diagonal.',
  },
  {
    kind: 'knight',
    name: 'The Knight',
    once: 'Ashva, the horse',
    note: 'The only piece that jumps, and it has never once gone straight.',
  },
  {
    kind: 'pawn',
    name: 'Eight Pawns',
    once: 'Padati, the foot soldiers',
    note: 'Front and centre, every night. Reach the far rank and become anyone you like.',
  },
] as const;

/** How the game's name travelled: each stop borrowed the word from the one before. */
export const JOURNEY = [
  { word: 'chaturanga', where: 'India', native: 'चतुरङ्ग', lang: 'sa', font: 'deva' },
  { word: 'shatranj', where: 'Persia', native: 'شطرنج', lang: 'fa', font: 'arab' },
  { word: 'ajedrez', where: 'Spain', native: null, lang: 'es', font: null },
  { word: 'scacchi', where: 'Italy', native: null, lang: 'it', font: null },
  { word: 'échecs', where: 'France', native: null, lang: 'fr', font: null },
  { word: 'chess', where: 'Everywhere', native: null, lang: 'en', font: null },
] as const;
