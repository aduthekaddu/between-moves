import localFont from 'next/font/local';

/*
 * Landing-only subsets: each file carries just the glyphs for the word "chess" in its
 * script, so twelve scripts cost less than one photograph. Not preloaded. next/font needs
 * literal options, so each family is spelled out.
 */

export const anekDevanagari = localFont({
  src: '../fonts/anek-devanagari.woff2',
  variable: '--font-deva',
  weight: '100 800',
  display: 'swap',
  preload: false,
  declarations: [{ prop: 'font-stretch', value: '75% 125%' }],
});

export const anekBangla = localFont({
  src: '../fonts/anek-bangla.woff2',
  variable: '--font-beng',
  weight: '100 800',
  display: 'swap',
  preload: false,
  declarations: [{ prop: 'font-stretch', value: '75% 125%' }],
});

export const anekTamil = localFont({
  src: '../fonts/anek-tamil.woff2',
  variable: '--font-taml',
  weight: '100 800',
  display: 'swap',
  preload: false,
  declarations: [{ prop: 'font-stretch', value: '75% 125%' }],
});

export const anekTelugu = localFont({
  src: '../fonts/anek-telugu.woff2',
  variable: '--font-telu',
  weight: '100 800',
  display: 'swap',
  preload: false,
  declarations: [{ prop: 'font-stretch', value: '75% 125%' }],
});

export const anekKannada = localFont({
  src: '../fonts/anek-kannada.woff2',
  variable: '--font-knda',
  weight: '100 800',
  display: 'swap',
  preload: false,
  declarations: [{ prop: 'font-stretch', value: '75% 125%' }],
});

export const anekMalayalam = localFont({
  src: '../fonts/anek-malayalam.woff2',
  variable: '--font-mlym',
  weight: '100 800',
  display: 'swap',
  preload: false,
  declarations: [{ prop: 'font-stretch', value: '75% 125%' }],
});

export const anekGujarati = localFont({
  src: '../fonts/anek-gujarati.woff2',
  variable: '--font-gujr',
  weight: '100 800',
  display: 'swap',
  preload: false,
  declarations: [{ prop: 'font-stretch', value: '75% 125%' }],
});

export const anekGurmukhi = localFont({
  src: '../fonts/anek-gurmukhi.woff2',
  variable: '--font-guru',
  weight: '100 800',
  display: 'swap',
  preload: false,
  declarations: [{ prop: 'font-stretch', value: '75% 125%' }],
});

export const anekOdia = localFont({
  src: '../fonts/anek-odia.woff2',
  variable: '--font-orya',
  weight: '100 800',
  display: 'swap',
  preload: false,
  declarations: [{ prop: 'font-stretch', value: '75% 125%' }],
});

export const notoNastaliq = localFont({
  src: '../fonts/noto-nastaliq-urdu.woff2',
  variable: '--font-arab',
  weight: '400 700',
  display: 'swap',
  preload: false,
});

export const scriptFontVariables = [
  anekDevanagari,
  anekBangla,
  anekTamil,
  anekTelugu,
  anekKannada,
  anekMalayalam,
  anekGujarati,
  anekGurmukhi,
  anekOdia,
  notoNastaliq,
]
  .map((font) => font.variable)
  .join(' ');
