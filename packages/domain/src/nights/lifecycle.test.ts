import { describe, expect, it } from 'vitest';
import { DomainError } from '../shared/errors';
import { transitionNightLifecycle } from './lifecycle';

describe('Between Moves Night lifecycle', () => {
  it('[BM-035] [DR-NIGHT-03] starts a scheduled Night and ends a live Night', () => {
    expect(transitionNightLifecycle('scheduled', 'start')).toEqual({
      state: 'live',
      changedNow: true,
    });
    expect(transitionNightLifecycle('live', 'end')).toEqual({
      state: 'ended',
      changedNow: true,
    });
  });

  it('[BM-035] treats a repeated start or end as idempotent', () => {
    expect(transitionNightLifecycle('live', 'start')).toEqual({
      state: 'live',
      changedNow: false,
    });
    expect(transitionNightLifecycle('ended', 'end')).toEqual({
      state: 'ended',
      changedNow: false,
    });
  });

  it('[BM-035] rejects start/end from cancelled or reversed states', () => {
    expect(() => transitionNightLifecycle('cancelled', 'start')).toThrow(DomainError);
    expect(() => transitionNightLifecycle('cancelled', 'end')).toThrow(DomainError);
    expect(() => transitionNightLifecycle('scheduled', 'end')).toThrow(DomainError);
    expect(() => transitionNightLifecycle('ended', 'start')).toThrow(DomainError);
    try {
      transitionNightLifecycle('scheduled', 'end');
    } catch (error) {
      expect(error).toMatchObject({ code: 'conflict' });
    }
  });
});
