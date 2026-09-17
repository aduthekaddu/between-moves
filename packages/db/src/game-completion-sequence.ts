import type { PoolClient } from 'pg';

/**
 * [BM-034] Allocate the durable, Season-scoped order used by the Game scoring cap.
 *
 * Updating the Season row serializes concurrent completions before their outbox
 * events can become visible. Later completions therefore cannot acquire an
 * earlier scoring position, even when their application timestamps are older.
 */
export async function allocateGameCompletionSequence(
  client: PoolClient,
  houseId: string,
  seasonId: string,
): Promise<bigint> {
  const result = await client.query<{ value: string }>(
    `update seasons
        set game_completion_sequence=game_completion_sequence+1
      where id=$1 and house_id=$2
      returning game_completion_sequence::text as value`,
    [seasonId, houseId],
  );
  const value = result.rows[0]?.value;
  if (value === undefined || !/^\d+$/.test(value) || BigInt(value) < 1n) {
    throw new Error('Game Season completion sequence is unavailable');
  }
  return BigInt(value);
}
