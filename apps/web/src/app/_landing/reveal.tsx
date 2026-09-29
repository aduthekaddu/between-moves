'use client';

import { useEffect } from 'react';

/**
 * One observer for the whole page: elements marked data-reveal get data-inview once they
 * cross into view, and CSS does the rest. `data-js` on the root lets CSS hold unrevealed
 * elements back only when this observer is actually running.
 */
export function RevealObserver() {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>('.lp');
    const targets = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]'));
    const reviewing =
      process.env.NODE_ENV !== 'production' && new URLSearchParams(window.location.search).has('t');
    if (reviewing || !('IntersectionObserver' in window)) {
      targets.forEach((target) => target.setAttribute('data-inview', 'true'));
      return;
    }
    // anything already on screen is shown straight away, without a replayed entrance
    const vh = window.innerHeight;
    for (const target of targets) {
      const rect = target.getBoundingClientRect();
      if (rect.top < vh && rect.bottom > 0) target.setAttribute('data-inview', 'true');
    }
    root?.setAttribute('data-js', 'true');
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.setAttribute('data-inview', 'true');
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: '0px 0px -14% 0px', threshold: 0.2 },
    );
    targets.forEach((target) => {
      if (!target.hasAttribute('data-inview')) observer.observe(target);
    });
    return () => observer.disconnect();
  }, []);
  return null;
}
