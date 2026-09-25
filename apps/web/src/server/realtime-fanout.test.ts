import { describe, expect, it, vi } from 'vitest';
import { RealtimeNightFanout } from './realtime-fanout';

const envelope = {
  id: '01941f29-7c00-7000-8000-000000000501',
  channel: 'n'.repeat(22),
  name: 'game.move-accepted',
  sequence: '2',
  data: { aggregateId: '01941f29-7c00-7000-8000-000000000801', san: 'e5' },
  occurredAt: '2026-09-04T14:00:00.000Z',
};

describe('Realtime Night fan-out', () => {
  it('[BM-038] delivers once per event ID to Night subscribers', () => {
    const fanout = new RealtimeNightFanout();
    const nightId = '01941f29-7c00-7000-8000-000000000901';
    const listener = vi.fn();
    const unsubscribe = fanout.subscribe(nightId, listener);

    expect(fanout.publish(nightId, envelope)).toBe('published');
    expect(fanout.publish(nightId, envelope)).toBe('duplicate');
    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(envelope);

    unsubscribe();
    expect(
      fanout.publish(nightId, { ...envelope, id: '01941f29-7c00-7000-8000-000000000502' }),
    ).toBe('published');
    expect(listener).toHaveBeenCalledOnce();
  });

  it('[BM-043] delivers Game updates to Game subscribers without a Night', () => {
    const fanout = new RealtimeNightFanout();
    const listener = vi.fn();
    const unsubscribe = fanout.subscribeGame(envelope.channel, listener);
    expect(fanout.publish(null, envelope)).toBe('published');
    expect(listener).toHaveBeenCalledWith(envelope);
    unsubscribe();
    fanout.publish(null, { ...envelope, id: '01941f29-7c00-7000-8000-000000000503' });
    expect(listener).toHaveBeenCalledOnce();
  });
});
