import { describe, expect, it } from 'vitest';
import { dueLabel } from './due-label';

const now = Date.parse('2026-11-04T12:00:00.000Z');
const at = (hours: number) => new Date(now + hours * 3_600_000);

describe('due label', () => {
  it('rounds to the unit a reader cares about', () => {
    expect(dueLabel(at(23.4), now)).toBe('due in 23 h');
    expect(dueLabel(at(0.5), now)).toBe('due in 30 min');
    expect(dueLabel(at(72), now)).toBe('due in 3 days');
  });

  it('says how late a Move is', () => {
    expect(dueLabel(at(-2), now)).toBe('overdue by 2 h');
  });
});
