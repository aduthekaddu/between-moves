import localFont from 'next/font/local';

/*
 * Landing-only subsets for the word's journey: each file carries just the glyphs (and the
 * shaping) for one spelling of the game's name, so they cost less than a photograph. Not
 * preloaded; next/font needs literal options, so each family is spelled out.
 */

/** चतुरङ्ग, chaturanga, in Anek Devanagari (Ek Type, OFL). */
export const anekDevanagari = localFont({
  src: '../fonts/anek-devanagari.woff2',
  variable: '--font-deva',
  weight: '100 800',
  display: 'swap',
  preload: false,
  declarations: [{ prop: 'font-stretch', value: '75% 125%' }],
});

/** شطرنج, shatranj, in Noto Nastaliq Urdu (OFL). */
export const notoNastaliq = localFont({
  src: '../fonts/noto-nastaliq-urdu.woff2',
  variable: '--font-arab',
  weight: '400 700',
  display: 'swap',
  preload: false,
});
