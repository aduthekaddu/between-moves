/** Landing-page copy and specimens. House vocabulary stays aligned with the product. */

export const WEEK_POSTCARDS = [
  {
    image: 'train',
    postmark: ['Mumbai', 'Mon', '08:12'],
    move: '14. d5',
    who: 'Anjali',
    line: 'Anjali pushes a pawn somewhere between Dadar and Churchgate.',
    gap: null,
  },
  {
    image: 'night',
    postmark: ['Pune', 'Tue', '23:40'],
    move: '14… exd5',
    who: 'Kabir',
    line: 'Kabir answers at 11:40 pm. The cat was asleep. Kabir was not.',
    gap: '39 h',
  },
  {
    image: 'lunch',
    postmark: ['Bengaluru', 'Thu', '13:05'],
    move: '15. Bxh7+',
    who: 'Rohan',
    line: 'Rohan finds the sacrifice between dal and a deadline.',
    gap: '37 h',
  },
  {
    image: 'balcony',
    postmark: ['Chennai', 'Sat', '07:30'],
    move: '15… Kxh7',
    who: 'Lakshmi',
    line: 'Lakshmi takes the bishop after filter coffee. Two days to spare.',
    gap: '42 h',
  },
] as const;

export const RAIL_CHAT = [
  { who: 'Farhan', body: 'that bishop is just hanging??' },
  { who: 'Lakshmi', body: 'it’s bait. watch.' },
  { who: 'Kabir', body: 'chai’s getting cold, someone move' },
  { who: 'Anjali', body: 'Check.' },
  { who: 'Rohan', body: 'rematch next Thursday. same table.' },
] as const;

export const RAIL_PRESENCE = [
  { name: 'Anjali', silhouette: 'braid' },
  { name: 'Kabir', silhouette: 'headphones' },
  { name: 'Uncle Joseph', silhouette: 'chai' },
  { name: 'Lakshmi', silhouette: 'dupatta' },
  { name: 'Farhan', silhouette: 'cap' },
] as const;

export const STANDINGS = [
  { rank: 1, name: 'Lakshmi', points: 19 },
  { rank: 2, name: 'Kabir', points: 17 },
  { rank: 2, name: 'Anjali', points: 17 },
  { rank: 4, name: 'Rohan', points: 12 },
  { rank: 5, name: 'Farhan', points: 9 },
] as const;

export const CHESS_WORDS = [
  { word: 'Chess', lang: 'en', language: 'English', say: 'chess', font: 'var(--font-anek)' },
  { word: 'शतरंज', lang: 'hi', language: 'Hindi', say: 'shatranj', font: 'var(--font-deva)' },
  {
    word: 'சதுரங்கம்',
    lang: 'ta',
    language: 'Tamil',
    say: 'chathurangam',
    font: 'var(--font-taml)',
  },
  { word: 'చదరంగం', lang: 'te', language: 'Telugu', say: 'chadarangam', font: 'var(--font-telu)' },
  { word: 'দাবা', lang: 'bn', language: 'Bangla', say: 'daba', font: 'var(--font-beng)' },
  { word: 'ಚದುರಂಗ', lang: 'kn', language: 'Kannada', say: 'chaduranga', font: 'var(--font-knda)' },
  { word: 'बुद्धिबळ', lang: 'mr', language: 'Marathi', say: 'buddhibal', font: 'var(--font-deva)' },
  {
    word: 'ചതുരംഗം',
    lang: 'ml',
    language: 'Malayalam',
    say: 'chathurangam',
    font: 'var(--font-mlym)',
  },
  { word: 'શતરંજ', lang: 'gu', language: 'Gujarati', say: 'shatranj', font: 'var(--font-gujr)' },
  { word: 'ਸ਼ਤਰੰਜ', lang: 'pa', language: 'Punjabi', say: 'shatranj', font: 'var(--font-guru)' },
  { word: 'ଶତରଞ୍ଜ', lang: 'or', language: 'Odia', say: 'shataranja', font: 'var(--font-orya)' },
  { word: 'شطرنج', lang: 'ur', language: 'Urdu', say: 'shatranj', font: 'var(--font-arab)' },
  { word: 'चतुरङ्ग', lang: 'sa', language: 'Sanskrit', say: 'caturaṅga', font: 'var(--font-deva)' },
] as const;

/** A back-rank finish from one of the House's own games. */
export const PUZZLE = {
  fen: '6k1/5ppp/8/8/8/8/2r2PPP/3R2K1 w - - 0 1',
  from: 'd1',
  to: 'd8',
  source: 'Anjali v Rohan · move 31',
  prompt: 'White to play. Rohan missed it. Will you?',
} as const;

/** The House Set, introduced by the names the pieces had in chaturanga. */
export const CAST = [
  {
    kind: 'king',
    sanskrit: 'राजा',
    name: 'Raja',
    english: 'King',
    facets: 148,
    note: 'One square at a time. The whole House exists to keep him there.',
  },
  {
    kind: 'queen',
    sanskrit: 'मन्त्री',
    name: 'Mantri',
    english: 'Queen',
    facets: 200,
    note: 'Began as the king’s counsellor, one careful step at a time. Now nothing moves further.',
  },
  {
    kind: 'rook',
    sanskrit: 'रथ',
    name: 'Ratha',
    english: 'Rook',
    facets: 150,
    note: 'The chariot. Straight lines, open files, no patience at all.',
  },
  {
    kind: 'bishop',
    sanskrit: 'गज',
    name: 'Gaja',
    english: 'Bishop',
    facets: 160,
    note: 'An elephant, originally. Still takes the long way round, on the diagonal.',
  },
  {
    kind: 'knight',
    sanskrit: 'अश्व',
    name: 'Ashva',
    english: 'Knight',
    facets: 318,
    note: 'The horse. The only piece that jumps, and it has never once gone straight.',
  },
  {
    kind: 'pawn',
    sanskrit: 'पदाति',
    name: 'Padati',
    english: 'Pawn',
    facets: 104,
    note: 'The foot soldier. Reach the far rank and become anyone you like.',
  },
] as const;
