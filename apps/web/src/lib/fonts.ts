import localFont from 'next/font/local';

/**
 * Anek by Ek Type (OFL): one variable family (weight 100–800, width 75–125) drawn for
 * Latin and nine Indian scripts. Latin carries the whole interface.
 */
export const anek = localFont({
  src: '../fonts/anek-latin.woff2',
  variable: '--font-anek',
  weight: '100 800',
  display: 'swap',
  declarations: [{ prop: 'font-stretch', value: '75% 125%' }],
  adjustFontFallback: 'Arial',
});

/** IBM Plex Mono (OFL) for notation, clocks, postmarks and captions. */
export const plexMono = localFont({
  src: [
    { path: '../fonts/plex-mono-regular.woff2', weight: '400', style: 'normal' },
    { path: '../fonts/plex-mono-medium.woff2', weight: '500', style: 'normal' },
    { path: '../fonts/plex-mono-semibold.woff2', weight: '600', style: 'normal' },
  ],
  variable: '--font-mono',
  display: 'swap',
  adjustFontFallback: false,
});
