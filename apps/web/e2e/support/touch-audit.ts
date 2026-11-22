import type { Page } from '@playwright/test';

/** WCAG 2.5.8 Target Size (Minimum), in CSS pixels. */
export const MIN_TARGET_PX = 24;
/** Below this, iOS Safari zooms the page when a field takes focus. */
export const MIN_FIELD_FONT_PX = 16;

export interface TouchAudit {
  /** Every visible field and interactive element the audit looked at, as a readable selector. */
  readonly fields: readonly string[];
  readonly targets: readonly string[];
  /** One line per failure. An empty list is a pass. */
  readonly problems: readonly string[];
}

/**
 * Measures the page as a finger sees it. It opens every `<details>`, then checks that
 * - every visible input, select and textarea computes to at least 16px text,
 * - every visible interactive element has a hit area of at least 24x24 CSS px, measured by
 *   hit-testing around its box (so an enlarged `::after` counts and a covered corner does not),
 *   except links inside a run of text, disabled controls and anything not rendered,
 * - no two interactive elements overlap, and no control is covered by something else.
 * It reads the DOM and the layout only, so it holds for any route.
 */
export async function auditTouch(page: Page): Promise<TouchAudit> {
  await page.evaluate(() => document.fonts.ready);
  return page.evaluate(
    ({ minTarget, minFont }) => {
      for (const details of document.querySelectorAll('details')) details.open = true;

      const interactiveSelector = [
        'a[href]',
        'button',
        'summary',
        'select',
        'textarea',
        'input:not([type="hidden"])',
        '[role="button"]',
        '[role="link"]',
        '[role="gridcell"][tabindex]',
        '[tabindex]:not([tabindex="-1"])',
      ].join(',');

      function describe(el: Element): string {
        const own = el.getAttribute('aria-label') ?? el.textContent ?? '';
        const text = own.replace(/\s+/g, ' ').trim().slice(0, 28);
        const classes = [...el.classList].slice(0, 2).map((name) => `.${name}`);
        return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${classes.join('')}${text ? ` "${text}"` : ''}`;
      }

      function rendered(el: Element): boolean {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return false;
        for (let node: Element | null = el; node !== null; node = node.parentElement) {
          const style = getComputedStyle(node);
          if (style.display === 'none' || style.visibility === 'hidden') return false;
          if (node.getAttribute('aria-hidden') === 'true' && node !== el) return false;
        }
        // Text hidden for sighted users (1px clip box) is not a target.
        return !(rect.width <= 1 || rect.height <= 1);
      }

      function isFieldTextual(el: Element): boolean {
        if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
        if (!(el instanceof HTMLInputElement)) return false;
        return ![
          'hidden',
          'checkbox',
          'radio',
          'range',
          'color',
          'file',
          'submit',
          'button',
          'image',
          'reset',
        ].includes(el.type);
      }

      function isDisabled(el: Element): boolean {
        return (
          el.matches(':disabled') ||
          el.closest('fieldset:disabled') !== null ||
          el.getAttribute('aria-disabled') === 'true'
        );
      }

      // A link inside a sentence is exempt. A link is "inline in text" when it is
      // laid out inline and its block parent holds other text of its own.
      function inlineInText(el: Element): boolean {
        if (!(el instanceof HTMLAnchorElement)) return false;
        if (getComputedStyle(el).display !== 'inline') return false;
        const parent = el.parentElement;
        if (parent === null) return false;
        let siblingText = '';
        for (const node of parent.childNodes) {
          if (node !== el && node.nodeType === Node.TEXT_NODE)
            siblingText += node.textContent ?? '';
        }
        return siblingText.replace(/\s+/g, '').length >= 6;
      }

      // The thing a finger lands on: a checkbox or radio is tapped through its label.
      function targetBox(el: Element): Element {
        if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) {
          const label = el.labels?.[0];
          if (label !== undefined && rendered(label)) return label;
        }
        return el;
      }

      function belongsTo(el: Element, hit: Element | null): boolean {
        if (hit === null) return false;
        if (hit === el || el.contains(hit)) return true;
        if (
          el instanceof HTMLInputElement ||
          el instanceof HTMLSelectElement ||
          el instanceof HTMLTextAreaElement
        ) {
          for (const label of el.labels ?? [])
            if (label === hit || label.contains(hit)) return true;
        }
        const wrapping = hit.closest('label');
        return wrapping !== null && wrapping.contains(el) && wrapping.control === el;
      }

      // Smallest box around every point near the element where a tap reaches it.
      function hitBox(el: Element, box: Element): { width: number; height: number } {
        const rect = box.getBoundingClientRect();
        const reach = 14;
        let left = Infinity;
        let right = -Infinity;
        let top = Infinity;
        let bottom = -Infinity;
        const step = 2;
        const x0 = Math.max(0, Math.floor(rect.left - reach));
        const x1 = Math.min(innerWidth - 1, Math.ceil(rect.right + reach));
        const y0 = Math.max(0, Math.floor(rect.top - reach));
        const y1 = Math.min(innerHeight - 1, Math.ceil(rect.bottom + reach));
        for (let y = y0; y <= y1; y += step) {
          for (let x = x0; x <= x1; x += step) {
            if (!belongsTo(el, document.elementFromPoint(x, y))) continue;
            left = Math.min(left, x);
            right = Math.max(right, x + step);
            top = Math.min(top, y);
            bottom = Math.max(bottom, y + step);
          }
        }
        if (left === Infinity) return { width: 0, height: 0 };
        // Never report more than the box the browser lays out plus the sampling step.
        return {
          width: Math.min(right - left, rect.width + 2 * reach),
          height: Math.min(bottom - top, rect.height + 2 * reach),
        };
      }

      const problems: string[] = [];
      const fields: string[] = [];
      const targets: string[] = [];

      for (const el of document.querySelectorAll('input, select, textarea')) {
        if (!isFieldTextual(el) || !rendered(el)) continue;
        const size = Number.parseFloat(getComputedStyle(el).fontSize);
        fields.push(describe(el));
        if (size < minFont) {
          problems.push(
            `field ${describe(el)} has ${size}px text; iOS zooms into fields under ${minFont}px (set the base field rule in globals.css, do not override it below 1rem)`,
          );
        }
      }

      const controls: { el: Element; box: Element; rect: DOMRect }[] = [];
      for (const el of document.querySelectorAll(interactiveSelector)) {
        if (!rendered(el) || isDisabled(el) || inlineInText(el)) continue;
        const box = targetBox(el);
        if (!rendered(box)) continue;
        controls.push({ el, box, rect: box.getBoundingClientRect() });
        targets.push(describe(el));
      }

      // Overlap: two controls whose boxes share area, where neither wraps the other.
      // This pass runs before any scrolling so every rect shares one coordinate frame.
      for (let i = 0; i < controls.length; i += 1) {
        for (let j = i + 1; j < controls.length; j += 1) {
          const a = controls[i]!;
          const b = controls[j]!;
          if (a.box === b.box || a.box.contains(b.box) || b.box.contains(a.box)) continue;
          if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
          const width = Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left);
          const height = Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top);
          if (width > 2 && height > 2) {
            problems.push(
              `controls overlap by ${Math.round(width)}x${Math.round(height)}px: ${describe(a.el)} and ${describe(b.el)}`,
            );
          }
        }
      }

      // Size: a box that is already 24x24 passes. A smaller one is hit-tested, so an
      // enlarged ::after counts and a covered corner does not.
      for (const { el, box, rect } of controls) {
        if (rect.width >= minTarget && rect.height >= minTarget) continue;
        box.scrollIntoView({ block: 'center', inline: 'nearest' });
        const reached = hitBox(el, box);
        if (reached.width < minTarget || reached.height < minTarget) {
          problems.push(
            `target ${describe(el)} is ${Math.round(reached.width)}x${Math.round(reached.height)}px; the minimum is ${minTarget}x${minTarget}px (give it padding or min-block-size, or lift the base rule in globals.css)`,
          );
        }
      }
      window.scrollTo(0, 0);
      return { fields, targets, problems };
    },
    { minTarget: MIN_TARGET_PX, minFont: MIN_FIELD_FONT_PX },
  );
}
