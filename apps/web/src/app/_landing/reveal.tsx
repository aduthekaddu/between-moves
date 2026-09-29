'use client';

import { useEffect } from 'react';

/**
 * One observer for the whole page: elements marked data-reveal get data-inview once they
 * cross into view, and CSS does the rest. Nothing is tied to scroll position.
 */
export function RevealObserver() {
  useEffect(() => {
    const targets = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]'));
    const reviewing =
      process.env.NODE_ENV !== 'production' && new URLSearchParams(window.location.search).has('t');
    if (reviewing || !('IntersectionObserver' in window)) {
      targets.forEach((target) => target.setAttribute('data-inview', 'true'));
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.setAttribute('data-inview', 'true');
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: '0px 0px -12% 0px', threshold: 0.18 },
    );
    targets.forEach((target) => observer.observe(target));
    return () => observer.disconnect();
  }, []);
  return null;
}
