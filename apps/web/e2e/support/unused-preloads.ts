import type { Page } from '@playwright/test';

/**
 * Every `<link rel="preload">` in the document that nothing on the page uses, one line each.
 * An image counts as used when an `<img>` or `<source>` names one of its URLs (href or
 * imagesrcset). A font counts as used only when the page rendered with a face loaded from
 * that file, so a preloaded weight the page never draws is reported.
 */
export async function unusedPreloads(page: Page): Promise<string[]> {
  await page.evaluate(() => document.fonts.ready);
  return page.evaluate(() => {
    const absolute = (value: string): string => new URL(value, location.href).href;
    const candidates = (srcset: string | null): string[] =>
      (srcset ?? '')
        .split(',')
        .map((part) => part.trim().split(/\s+/)[0] ?? '')
        .filter(Boolean)
        .map(absolute);
    const used = new Set<string>();
    for (const image of document.querySelectorAll('img')) {
      if (image.currentSrc) used.add(absolute(image.currentSrc));
      const src = image.getAttribute('src');
      if (src) used.add(absolute(src));
      for (const url of candidates(image.getAttribute('srcset'))) used.add(url);
    }
    for (const source of document.querySelectorAll('source[srcset]')) {
      for (const url of candidates(source.getAttribute('srcset'))) used.add(url);
    }
    for (const element of document.querySelectorAll('link[rel="stylesheet"], script[src]')) {
      const url = element.getAttribute('href') ?? element.getAttribute('src');
      if (url) used.add(absolute(url));
    }
    // A font is used when a face the page rendered with loaded from that file. Each loaded
    // FontFace is matched to the @font-face rule with the same descriptors.
    const key = (family: string, style: string, weight: string, range: string) =>
      [family.replace(/["']/g, ''), style, weight, range.replace(/\s+/g, '').toLowerCase()].join(
        '|',
      );
    const loaded = new Set(
      [...document.fonts]
        .filter((face) => face.status === 'loaded')
        .map((face) => key(face.family, face.style, face.weight, face.unicodeRange)),
    );
    for (const sheet of document.styleSheets) {
      for (const rule of sheet.cssRules) {
        if (!(rule instanceof CSSFontFaceRule)) continue;
        const s = rule.style;
        const face = key(
          s.getPropertyValue('font-family'),
          s.getPropertyValue('font-style') || 'normal',
          s.getPropertyValue('font-weight') || 'normal',
          s.getPropertyValue('unicode-range') || 'U+0-10FFFF',
        );
        if (!loaded.has(face)) continue;
        for (const match of s.getPropertyValue('src').matchAll(/url\(["']?([^"')]+)["']?\)/g))
          used.add(new URL(match[1]!, sheet.href ?? location.href).href);
      }
    }
    const findings: string[] = [];
    for (const link of document.querySelectorAll('link[rel="preload"]')) {
      const as = link.getAttribute('as') ?? '?';
      const href = link.getAttribute('href');
      const urls = [
        ...(href ? [absolute(href)] : []),
        ...candidates(link.getAttribute('imagesrcset')),
      ];
      if (urls.length > 0 && urls.some((url) => used.has(url))) continue;
      findings.push(`preload as=${as} ${urls.join(' ') || link.outerHTML}`);
    }
    return findings;
  });
}
