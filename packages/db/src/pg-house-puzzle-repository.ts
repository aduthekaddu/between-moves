import {
  DomainError,
  PUZZLE_PUBLISHED_SCORING_TOPIC,
  type AuthorizationContext,
} from '@between-moves/domain';
import type { Pool } from 'pg';
import { enqueueOutboxEvent } from './enqueue-outbox-event';

export interface PuzzleCandidateReview {
  readonly id: string;
  readonly gameId: string;
  readonly sourcePly: number;
  readonly positionFen: string;
}

export interface PublishedHousePuzzle {
  readonly id: string;
  readonly prompt: string;
  readonly positionFen: string;
  readonly contributorName: string;
  readonly publishedAt: Date;
}

export interface HousePuzzleBoard {
  readonly candidates: readonly PuzzleCandidateReview[];
  readonly published: readonly PublishedHousePuzzle[];
}

/** [BM-046] Every read and write is tied to the authorized House and active actor. */
export class PgHousePuzzleRepository {
  constructor(private readonly database: Pool) {}

  async read(context: AuthorizationContext): Promise<HousePuzzleBoard> {
    const [candidates, published] = await Promise.all([
      this.database.query<{
        id: string;
        game_id: string;
        source_ply: number;
        position_fen: string;
      }>(
        `select c.id::text, c.game_id::text, c.source_ply, c.position_fen
           from puzzle_candidates c
           join memberships actor on actor.house_id=c.house_id and actor.user_id=$2 and actor.status='active'
           join seasons s on s.id=c.season_id and s.house_id=c.house_id and s.state='active'
             and s.starts_at <= now() and s.ends_at > now()
          where c.house_id=$1 and c.state='pending'
          order by c.created_at desc, c.id desc limit 30`,
        [context.houseId, context.viewerId],
      ),
      this.database.query<{
        id: string;
        prompt: string;
        position_fen: string;
        contributor_name: string;
        published_at: Date;
      }>(
        `select p.id::text, p.prompt, p.position_fen,
                case when m.status='active' then u.display_name else 'Former member' end as contributor_name,
                p.published_at
           from house_puzzles p
           join memberships actor on actor.house_id=p.house_id and actor.user_id=$2 and actor.status='active'
           join memberships m on m.id=p.contributor_membership_id and m.house_id=p.house_id
           join users u on u.id=m.user_id
          where p.house_id=$1
          order by p.published_at desc, p.id desc limit 30`,
        [context.houseId, context.viewerId],
      ),
    ]);
    return {
      candidates: candidates.rows.map((row) => ({
        id: row.id,
        gameId: row.game_id,
        sourcePly: row.source_ply,
        positionFen: row.position_fen,
      })),
      published: published.rows.map((row) => ({
        id: row.id,
        prompt: row.prompt,
        positionFen: row.position_fen,
        contributorName: row.contributor_name,
        publishedAt: row.published_at,
      })),
    };
  }

  async publish(
    context: AuthorizationContext,
    input: {
      candidateId: string;
      puzzleId: string;
      eventId: string;
      prompt: string;
      now: Date;
    },
  ): Promise<PublishedHousePuzzle> {
    const client = await this.database.connect();
    try {
      await client.query('begin');
      const selected = await client.query<{
        game_id: string;
        season_id: string;
        position_fen: string;
        actor_id: string;
        display_name: string;
      }>(
        `select c.game_id::text, c.season_id::text, c.position_fen,
                actor.id::text as actor_id, person.display_name
           from puzzle_candidates c
           join seasons s on s.id=c.season_id and s.house_id=c.house_id and s.state='active'
             and s.starts_at <= $4 and s.ends_at > $4
           join memberships actor on actor.house_id=c.house_id and actor.user_id=$3 and actor.status='active'
           join users person on person.id=actor.user_id
          where c.id=$1 and c.house_id=$2 and c.state='pending'
          for update of c`,
        [input.candidateId, context.houseId, context.viewerId, input.now],
      );
      const row = selected.rows[0];
      if (row === undefined) throw new DomainError('not_found', 'Puzzle candidate is unavailable');
      await client.query(
        `insert into house_puzzles
          (id,candidate_id,house_id,season_id,game_id,position_fen,prompt,
           contributor_membership_id,confirmed_by_membership_id,published_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$8,$9)`,
        [
          input.puzzleId,
          input.candidateId,
          context.houseId,
          row.season_id,
          row.game_id,
          row.position_fen,
          input.prompt,
          row.actor_id,
          input.now,
        ],
      );
      await client.query(
        `update puzzle_candidates set state='confirmed', reviewer_membership_id=$2
          where id=$1 and house_id=$3`,
        [input.candidateId, row.actor_id, context.houseId],
      );
      await enqueueOutboxEvent(
        {
          id: input.eventId,
          topic: PUZZLE_PUBLISHED_SCORING_TOPIC,
          aggregateId: input.puzzleId,
          sequence: 1n,
          houseId: context.houseId,
          payload: {
            puzzleId: input.puzzleId,
            contributorMembershipId: row.actor_id,
            seasonId: row.season_id,
          },
          availableAt: input.now,
          occurredAt: input.now,
        },
        client,
      );
      await client.query('commit');
      return {
        id: input.puzzleId,
        prompt: input.prompt,
        positionFen: row.position_fen,
        contributorName: row.display_name,
        publishedAt: input.now,
      };
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
