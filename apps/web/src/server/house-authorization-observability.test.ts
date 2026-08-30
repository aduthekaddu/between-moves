import { createAuthorizeHouseAction } from '@between-moves/application';
import type { AuthorizeHouseAction } from '@between-moves/domain';
import {
  createHouseAuthorizationMetricStubs,
  createStructuredLogger,
} from '@between-moves/observability';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { createHouseAuthorizationDenialRecorder } from './house-authorization-observability';

describe('House authorization denial observability', () => {
  it('[BM-012] exposes authorizeHouseAction(action, houseId, viewer)', () => {
    expectTypeOf(createAuthorizeHouseAction).returns.toEqualTypeOf<AuthorizeHouseAction>();
  });

  it('[BM-012] logs a structured denial and increments authz_denied_total', () => {
    const lines: string[] = [];
    const metrics = createHouseAuthorizationMetricStubs();
    const recorder = createHouseAuthorizationDenialRecorder({
      logger: createStructuredLogger({
        clock: { now: () => new Date('2026-08-30T00:00:00.000Z') },
        sink: (line) => lines.push(line),
      }),
      metrics,
      requestId: '01941f29-7c00-7000-8000-000000000001',
    });

    recorder.record({
      action: 'delete_house',
      actorId: '01941f29-7c00-7000-8000-000000000101',
      houseId: '01941f29-7c00-7000-8000-000000000201',
      reason: 'role_not_permitted',
      crossHouse: false,
    });

    expect(metrics.snapshot()).toEqual({ authz_denied_total: { false: 1, true: 0 } });
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? '')).toEqual({
      ts: '2026-08-30T00:00:00.000Z',
      level: 'warn',
      request_id: '01941f29-7c00-7000-8000-000000000001',
      actor_id: '01941f29-7c00-7000-8000-000000000101',
      house_id: '01941f29-7c00-7000-8000-000000000201',
      game_id: null,
      command_id: null,
      event: 'house.authorization-denied',
      outcome: 'rejected',
      duration_ms: 0,
      data: {
        action: 'delete_house',
        reason: 'role_not_permitted',
        cross_house: false,
      },
    });
  });
});
