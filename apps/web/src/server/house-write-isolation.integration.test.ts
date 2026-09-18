import {
  acceptGameSeat,
  changeMembershipRole,
  changeNightPresence,
  createAuthorizeHouseAction,
  createGameSeat,
  createInvitation,
  assignNightHost,
  changeNightSchedule,
  draftSeason,
  draftSeasonCharter,
  endNight,
  joinNight,
  leaveHouse,
  leaveNight,
  handleDraw,
  redeemInvitation,
  removeHouseMember,
  publishSeason,
  rsvpNight,
  revokeInvitation,
  resignGame,
  saveGameNote,
  setGameReaction,
  startNight,
  submitMove,
  transferHouseOwnership,
} from '@between-moves/application';
import {
  migrateDown,
  migrateUp,
  PgHouseAuthorizationMembershipRepository,
  PgGameSeatAcceptanceRepository,
  PgGameSeatRepository,
  PgGameCompletionRepository,
  PgGameReactionRepository,
  PgGameNoteRepository,
  PgInvitationRedemptionRepository,
  PgInvitationRepository,
  PgMembershipAdminRepository,
  PgNightAttendanceRepository,
  PgNightLifecycleRepository,
  PgNightRepository,
  PgNightRsvpRepository,
  PgSeasonRepository,
  PgSubmitMoveRepository,
} from '@between-moves/db';
import { twoHousesWithMembers, type TwoHousesWithMembers } from '@between-moves/db/testing';
import type {
  AuthenticatedViewer,
  AuthorizeHouseAction,
  Clock,
  GameSeatAcceptanceRepository,
  GameSeatCreationRepository,
  GameCompletionRepository,
  GameReactionRepository,
  GameNoteRepository,
  IdGenerator,
  InvitationCreationRepository,
  InvitationEmailDeliveryCodec,
  InvitationRedemptionRepository,
  InvitationRevocationRepository,
  InvitationTokenDigester,
  InvitationTokenIssuer,
  MembershipAdminRepository,
  NightAttendanceEventRecorder,
  NightAttendanceRepository,
  NightJoinLeaveRecorder,
  NightLifecycleRecorder,
  NightLifecycleRepository,
  NightPresenceRepository,
  NightRepository,
  NightRsvpRepository,
  NightScheduleChangeRecorder,
  SeasonRepository,
  SeasonTransitionRecorder,
  SubmitMoveRepository,
  RulesAdapter,
} from '@between-moves/domain';
import { fakeAuthorizationContext } from '@between-moves/domain/testing';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integration = testDatabaseUrl ? describe : describe.skip;
const migrationsDirectory = fileURLToPath(
  new URL('../../../../packages/db/migrations', import.meta.url),
);
const invitationId = '01941f29-7c00-7000-8000-000000000901';
const invitationDigest = 'c'.repeat(64);
const invitationToken = 'bm-017-first-house-invitation-token';
const seasonId = '01941f29-7c00-7000-8000-000000000971';
const charterId = '01941f29-7c00-7000-8000-000000000972';
const nightId = '01941f29-7c00-7000-8000-000000000973';
const waitingGameId = '01941f29-7c00-7000-8000-000000000974';
const waitingSeatId = '01941f29-7c00-7000-8000-000000000975';
const activeGameId = '01941f29-7c00-7000-8000-000000000976';

interface IsolationHarness {
  readonly world: TwoHousesWithMembers;
  readonly authorizeHouseAction: AuthorizeHouseAction;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly tokens: InvitationTokenIssuer & InvitationTokenDigester;
  readonly invitations: InvitationCreationRepository & InvitationRevocationRepository;
  readonly invitationEmail: {
    readonly codec: InvitationEmailDeliveryCodec;
    readonly buildUrl: (rawToken: string) => string;
  };
  readonly redemptions: InvitationRedemptionRepository;
  readonly memberships: MembershipAdminRepository;
  readonly attendance: NightAttendanceRepository;
  readonly events: NightAttendanceEventRecorder;
  readonly joinLeave: NightJoinLeaveRecorder;
  readonly nights: NightRepository;
  readonly lifecycle: NightLifecycleRepository;
  readonly presence: NightPresenceRepository;
  readonly rsvps: NightRsvpRepository;
  readonly lifecycleChanges: NightLifecycleRecorder;
  readonly acceptances: GameSeatAcceptanceRepository;
  readonly seats: GameSeatCreationRepository;
  readonly changes: NightScheduleChangeRecorder;
  readonly seasons: SeasonRepository;
  readonly transitions: SeasonTransitionRecorder;
  readonly moves: SubmitMoveRepository;
  readonly completions: GameCompletionRepository;
  readonly reactions: GameReactionRepository;
  readonly notes: GameNoteRepository;
  readonly rules: RulesAdapter;
}

interface IsolationCase {
  readonly id: string;
  readonly name: string;
  readonly outcome: 'denied' | 'invitation-target-scoped';
  readonly expectedError?: Readonly<Record<string, unknown>>;
  readonly run: (harness: IsolationHarness) => Promise<unknown>;
}

const cases: readonly IsolationCase[] = [
  {
    id: 'invitation.create',
    name: 'Invitation creation',
    outcome: 'denied',
    expectedError: {
      code: 'authorization_denied',
      reason: 'not_a_member',
      crossHouse: true,
    },
    run: (harness) =>
      createInvitation(
        {
          houseId: harness.world.second.houseId,
          command: { kind: 'shared' },
          idempotencyKey: null,
          viewer: viewer(harness.world.first.member),
        },
        harness,
      ),
  },
  {
    id: 'invitation.revoke',
    name: 'Invitation revocation',
    outcome: 'denied',
    expectedError: { code: 'not_found' },
    run: (harness) =>
      revokeInvitation(
        {
          houseId: harness.world.second.houseId,
          invitationId,
          viewer: viewer(harness.world.second.member),
        },
        harness,
      ),
  },
  {
    id: 'invitation.redeem',
    name: 'Invitation redemption',
    outcome: 'invitation-target-scoped',
    run: (harness) =>
      redeemInvitation(
        { token: invitationToken, viewer: viewer(harness.world.second.member) },
        {
          clock: harness.clock,
          ids: harness.ids,
          tokens: harness.tokens,
          invitations: harness.redemptions,
        },
      ),
  },
  {
    id: 'membership.change-role',
    name: 'membership role change',
    outcome: 'denied',
    expectedError: { code: 'not_found' },
    run: (harness) =>
      changeMembershipRole(
        {
          houseId: harness.world.second.houseId,
          targetMembershipId: harness.world.first.nonOwner.membershipId,
          role: 'steward',
          viewer: viewer(harness.world.second.member),
        },
        harness,
      ),
  },
  {
    id: 'membership.remove',
    name: 'Member removal',
    outcome: 'denied',
    expectedError: { code: 'not_found' },
    run: (harness) =>
      removeHouseMember(
        {
          houseId: harness.world.second.houseId,
          targetMembershipId: harness.world.first.nonOwner.membershipId,
          viewer: viewer(harness.world.second.member),
        },
        harness,
      ),
  },
  {
    id: 'membership.leave',
    name: 'House leave',
    outcome: 'denied',
    expectedError: {
      code: 'authorization_denied',
      reason: 'not_a_member',
      crossHouse: true,
    },
    run: (harness) =>
      leaveHouse(
        {
          houseId: harness.world.second.houseId,
          viewer: viewer(harness.world.first.nonOwner),
        },
        harness,
      ),
  },
  {
    id: 'ownership.transfer',
    name: 'ownership transfer',
    outcome: 'denied',
    expectedError: { code: 'validation_failed' },
    run: (harness) =>
      transferHouseOwnership(
        {
          houseId: harness.world.second.houseId,
          targetMembershipId: harness.world.first.nonOwner.membershipId,
          idempotencyKey: 'bm-017-cross-house-transfer',
          viewer: viewer(harness.world.second.member),
        },
        harness,
      ),
  },
  {
    id: 'season.draft',
    name: 'Season draft creation',
    outcome: 'denied',
    expectedError: {
      code: 'authorization_denied',
      reason: 'not_a_member',
      crossHouse: true,
    },
    run: (harness) =>
      draftSeason(
        {
          houseId: harness.world.second.houseId,
          title: 'Crossed table',
          idempotencyKey: 'bm-019-cross-house-draft',
          viewer: viewer(harness.world.first.member),
        },
        harness,
      ),
  },
  {
    id: 'season.charter',
    name: 'Charter version creation',
    outcome: 'denied',
    expectedError: { code: 'not_found' },
    run: (harness) =>
      draftSeasonCharter(
        {
          houseId: harness.world.second.houseId,
          seasonId,
          correspondencePaceHours: 48,
          nightRecurrence: { weekday: 4, localTime: '20:00', count: 4 },
          viewer: viewer(harness.world.second.member),
        },
        harness,
      ),
  },
  {
    id: 'season.publish',
    name: 'Season publication',
    outcome: 'denied',
    expectedError: { code: 'not_found' },
    run: (harness) =>
      publishSeason(
        {
          houseId: harness.world.second.houseId,
          seasonId,
          title: 'Crossed table',
          startsAt: new Date('2026-09-04T00:00:00.000Z'),
          endsAt: new Date('2026-10-02T00:00:00.000Z'),
          viewer: viewer(harness.world.second.member),
        },
        harness,
      ),
  },
  {
    id: 'night.schedule-change',
    name: 'Night schedule change',
    outcome: 'denied',
    expectedError: { code: 'not_found' },
    run: (harness) =>
      changeNightSchedule(
        {
          houseId: harness.world.second.houseId,
          nightId,
          command: { kind: 'cancel' },
          viewer: viewer(harness.world.second.member),
        },
        harness,
      ),
  },
  {
    id: 'night.start',
    name: 'Night start',
    outcome: 'denied',
    expectedError: {
      code: 'authorization_denied',
      reason: 'not_a_member',
      crossHouse: true,
    },
    run: (harness) =>
      startNight(
        {
          houseId: harness.world.second.houseId,
          nightId,
          viewer: viewer(harness.world.first.nonOwner),
        },
        {
          authorizeHouseAction: harness.authorizeHouseAction,
          clock: harness.clock,
          ids: harness.ids,
          lifecycle: harness.lifecycle,
          rsvps: harness.rsvps,
          changes: harness.lifecycleChanges,
        },
      ),
  },
  {
    id: 'night.end',
    name: 'Night end',
    outcome: 'denied',
    expectedError: {
      code: 'authorization_denied',
      reason: 'not_a_member',
      crossHouse: true,
    },
    run: (harness) =>
      endNight(
        {
          houseId: harness.world.second.houseId,
          nightId,
          viewer: viewer(harness.world.first.nonOwner),
        },
        {
          authorizeHouseAction: harness.authorizeHouseAction,
          clock: harness.clock,
          ids: harness.ids,
          lifecycle: harness.lifecycle,
          rsvps: harness.rsvps,
          changes: harness.lifecycleChanges,
        },
      ),
  },
  {
    id: 'night.host-assign',
    name: 'Night host assignment',
    outcome: 'denied',
    expectedError: {
      code: 'authorization_denied',
      reason: 'not_a_member',
      crossHouse: true,
    },
    run: (harness) =>
      assignNightHost(
        {
          houseId: harness.world.second.houseId,
          nightId,
          hostMembershipId: harness.world.first.nonOwner.membershipId,
          viewer: viewer(harness.world.first.member),
        },
        {
          authorizeHouseAction: harness.authorizeHouseAction,
          clock: harness.clock,
          ids: harness.ids,
          lifecycle: harness.lifecycle,
          rsvps: harness.rsvps,
          changes: harness.lifecycleChanges,
        },
      ),
  },
  {
    id: 'night.rsvp',
    name: 'Night RSVP',
    outcome: 'denied',
    expectedError: {
      code: 'authorization_denied',
      reason: 'not_a_member',
      crossHouse: true,
    },
    run: (harness) =>
      rsvpNight(
        {
          houseId: harness.world.second.houseId,
          nightId,
          status: 'going',
          viewer: viewer(harness.world.first.nonOwner),
        },
        {
          authorizeHouseAction: harness.authorizeHouseAction,
          clock: harness.clock,
          ids: harness.ids,
          lifecycle: harness.lifecycle,
          rsvps: harness.rsvps,
          changes: harness.lifecycleChanges,
        },
      ),
  },
  {
    id: 'night.attendance-join',
    name: 'Night attendance join',
    outcome: 'denied',
    expectedError: {
      code: 'authorization_denied',
      reason: 'not_a_member',
      crossHouse: true,
    },
    run: (harness) =>
      joinNight(
        {
          houseId: harness.world.second.houseId,
          nightId,
          viewer: viewer(harness.world.first.nonOwner),
        },
        harness,
      ),
  },
  {
    id: 'night.attendance-leave',
    name: 'Night attendance leave',
    outcome: 'denied',
    expectedError: {
      code: 'authorization_denied',
      reason: 'not_a_member',
      crossHouse: true,
    },
    run: (harness) =>
      leaveNight(
        {
          houseId: harness.world.second.houseId,
          nightId,
          viewer: viewer(harness.world.first.nonOwner),
        },
        harness,
      ),
  },
  {
    id: 'night.presence-change',
    name: 'Night presence change',
    outcome: 'denied',
    expectedError: {
      code: 'authorization_denied',
      reason: 'not_a_member',
      crossHouse: true,
    },
    run: (harness) =>
      changeNightPresence(
        {
          houseId: harness.world.second.houseId,
          nightId,
          viewer: viewer(harness.world.first.nonOwner),
          command: {
            kind: 'enter',
            token: 'signed-presence-token-that-is-long-enough',
            presence: {
              clientId: harness.world.first.nonOwner.userId,
              displayName: harness.world.first.nonOwner.displayName,
              signature: 's'.repeat(43),
            },
          },
        },
        {
          authorizeHouseAction: harness.authorizeHouseAction,
          clock: harness.clock,
          nights: {
            read: async () => {
              throw new Error('Cross-House presence must not read the Night');
            },
          },
          presence: harness.presence,
          verifyPresence: () => {
            throw new Error('Cross-House presence must not verify identity');
          },
        },
      ),
  },
  {
    id: 'game.seat-create',
    name: 'Game seat creation',
    outcome: 'denied',
    expectedError: {
      code: 'authorization_denied',
      reason: 'not_a_member',
      crossHouse: true,
    },
    run: (harness) =>
      createGameSeat(
        {
          houseId: harness.world.second.houseId,
          mode: 'correspondence',
          clockPolicy: { kind: 'correspondence', perMoveHours: 24 },
          offeredColor: 'any',
          intendedMembershipId: null,
          idempotencyKey: null,
          viewer: viewer(harness.world.first.nonOwner),
        },
        { ...harness, colors: { choose: () => 'white' } },
      ),
  },
  {
    id: 'game.seat-accept',
    name: 'Game seat acceptance',
    outcome: 'denied',
    expectedError: { code: 'not_found' },
    run: (harness) =>
      acceptGameSeat(
        {
          houseId: harness.world.second.houseId,
          gameId: waitingGameId,
          viewer: viewer(harness.world.second.member),
        },
        harness,
      ),
  },
  {
    id: 'game.move-submit',
    name: 'Move submission',
    outcome: 'denied',
    expectedError: { code: 'not_found' },
    run: (harness) =>
      submitMove(
        {
          houseId: harness.world.second.houseId,
          gameId: activeGameId,
          expectedPly: 0,
          clientCommandId: '01941f29-7c00-7000-8000-000000000977',
          move: { from: 'e2', to: 'e4' },
          viewer: viewer(harness.world.second.member),
        },
        harness,
      ),
  },
  {
    id: 'game.resign',
    name: 'Game resignation',
    outcome: 'denied',
    expectedError: { code: 'not_found' },
    run: (harness) =>
      resignGame(
        {
          houseId: harness.world.second.houseId,
          gameId: activeGameId,
          clientCommandId: '01941f29-7c00-7000-8000-000000000978',
          viewer: viewer(harness.world.second.member),
        },
        harness,
      ),
  },
  {
    id: 'game.draw',
    name: 'Game draw offer',
    outcome: 'denied',
    expectedError: { code: 'not_found' },
    run: (harness) =>
      handleDraw(
        {
          houseId: harness.world.second.houseId,
          gameId: activeGameId,
          action: 'offer',
          clientCommandId: '01941f29-7c00-7000-8000-000000000979',
          viewer: viewer(harness.world.second.member),
        },
        harness,
      ),
  },
  {
    id: 'game.reaction-set',
    name: 'Game Reaction set',
    outcome: 'denied',
    expectedError: { code: 'not_found' },
    run: (harness) =>
      setGameReaction(
        {
          houseId: harness.world.second.houseId,
          gameId: activeGameId,
          reaction: 'dramatic',
          viewer: viewer(harness.world.second.member),
        },
        harness,
      ),
  },
  {
    id: 'game.note-save',
    name: 'Game note save',
    outcome: 'denied',
    expectedError: { code: 'not_found' },
    run: (harness) =>
      saveGameNote(
        {
          houseId: harness.world.second.houseId,
          gameId: activeGameId,
          body: 'Crossed House note',
          viewer: viewer(harness.world.second.member),
        },
        harness,
      ),
  },
];

function viewer(member: {
  readonly userId: string;
  readonly displayName: string;
}): AuthenticatedViewer {
  return {
    kind: 'authenticated',
    userId: member.userId,
    displayName: member.displayName,
    imageUrl: null,
  };
}

function sequentialIds(): IdGenerator {
  let next = 920;
  return {
    generate: () => `01941f29-7c00-7000-8000-${String(next++).padStart(12, '0')}`,
  };
}

async function houseState(database: Pool, houseId: string): Promise<unknown> {
  const result = await database.query(
    `select jsonb_build_object(
       'owner', h.owner_membership_id::text,
       'memberships', coalesce((
         select jsonb_agg(jsonb_build_object(
           'id', m.id::text, 'user', m.user_id::text, 'role', m.role, 'status', m.status
         ) order by m.id)
         from memberships m where m.house_id = h.id
       ), '[]'::jsonb),
       'invitations', coalesce((
         select jsonb_agg(jsonb_build_object(
           'id', i.id::text, 'uses', i.use_count, 'revoked', i.revoked_at
         ) order by i.id)
         from invitations i where i.house_id = h.id
       ), '[]'::jsonb),
       'audits', coalesce((
         select jsonb_agg(jsonb_build_object(
           'id', a.id::text, 'action', a.action, 'target', a.target_membership_id::text
         ) order by a.id)
         from membership_audit a where a.house_id = h.id
       ), '[]'::jsonb),
       'seasons', coalesce((
         select jsonb_agg(jsonb_build_object(
           'id', s.id::text, 'state', s.state, 'version', s.published_charter_version,
           'charters', (select count(*) from season_charters c where c.season_id = s.id)
         ) order by s.id)
         from seasons s where s.house_id = h.id
       ), '[]'::jsonb),
       'nights', coalesce((
         select jsonb_agg(jsonb_build_object(
           'id', n.id::text, 'state', n.state, 'start', n.scheduled_start,
           'host', n.host_membership_id::text, 'started', n.started_at, 'ended', n.ended_at
         ) order by n.id)
         from house_nights n where n.house_id = h.id
       ), '[]'::jsonb),
       'night_rsvps', coalesce((
         select jsonb_agg(jsonb_build_object(
           'id', r.id::text, 'night', r.night_id::text, 'member', r.membership_id::text,
           'status', r.status
         ) order by r.id)
         from night_rsvps r where r.house_id = h.id
       ), '[]'::jsonb),
       'night_audit', coalesce((
         select jsonb_agg(jsonb_build_object('id', a.id::text, 'action', a.action) order by a.id)
         from night_audit a where a.house_id = h.id
       ), '[]'::jsonb),
       'night_attendance', coalesce((
         select jsonb_agg(jsonb_build_object(
           'id', a.id::text, 'night', a.night_id::text, 'member', a.membership_id::text,
           'seconds', a.accumulated_seconds
         ) order by a.id)
         from night_attendance a where a.house_id = h.id
       ), '[]'::jsonb),
       'night_attendance_events', coalesce((
         select jsonb_agg(jsonb_build_object(
           'id', e.id::text, 'night', e.night_id::text, 'kind', e.kind
         ) order by e.id)
         from night_attendance_events e where e.house_id = h.id
       ), '[]'::jsonb),
       'games', coalesce((
         select jsonb_agg(jsonb_build_object(
           'id', g.id::text, 'state', g.state, 'ply', g.current_ply, 'version', g.version,
           'moves', (select count(*) from moves m where m.game_id = g.id),
           'notes', (select count(*) from game_notes n where n.game_id = g.id)
         ) order by g.id)
         from games g where g.house_id = h.id
       ), '[]'::jsonb)
     ) as state
     from houses h where h.id = $1`,
    [houseId],
  );
  return result.rows[0]?.state;
}

integration('BM-017 current House write-path isolation', () => {
  const database = new Pool({ connectionString: testDatabaseUrl, max: 8 });
  let harness: IsolationHarness;

  beforeEach(async () => {
    await migrateDown(database, { migrationsDirectory, all: true });
    await migrateUp(database, { migrationsDirectory });
    const world = await twoHousesWithMembers(database);
    const invitations = new PgInvitationRepository(database);
    const clock = { now: () => new Date('2026-09-01T10:00:00.000Z') };
    const ids = sequentialIds();
    const tokens = {
      issue: () => ({ raw: invitationToken, digestHex: invitationDigest }),
      digest: (rawToken: string) => (rawToken === invitationToken ? invitationDigest : null),
    };
    const lifecycle = new PgNightLifecycleRepository(database);
    const authorizeHouseAction = createAuthorizeHouseAction({
      memberships: new PgHouseAuthorizationMembershipRepository(database),
      nightHosts: lifecycle,
      denials: { record: () => undefined },
    });
    const seasons = new PgSeasonRepository(database);
    await seasons.draft(
      fakeAuthorizationContext({
        viewerId: world.first.member.userId,
        houseId: world.first.houseId,
      }),
      {
        seasonId,
        title: 'First House Season',
        idempotencyKey: null,
        createdAt: clock.now(),
      },
    );
    await seasons.draftCharter(
      fakeAuthorizationContext({
        viewerId: world.first.member.userId,
        houseId: world.first.houseId,
      }),
      {
        charterId,
        seasonId,
        correspondencePaceHours: 24,
        nightRecurrence: { weekday: 5, localTime: '19:30', count: 4 },
        pointsRecipe: {
          completedGame: 1,
          win: 2,
          draw: 1,
          nightAttendance: 1,
          publishedPuzzle: 1,
          caps: { games: 8, nights: 4, puzzles: 2 },
        },
        createdAt: clock.now(),
      },
    );
    await database.query(
      `insert into house_nights
        (id, house_id, season_id, scheduled_start, scheduled_end, state, created_at, updated_at)
       values ($1, $2, $3, $4, $5, 'scheduled', $6, $6)`,
      [
        nightId,
        world.first.houseId,
        seasonId,
        new Date('2026-09-04T14:00:00.000Z'),
        new Date('2026-09-04T16:00:00.000Z'),
        clock.now(),
      ],
    );
    await invitations.create(
      fakeAuthorizationContext({
        viewerId: world.first.member.userId,
        houseId: world.first.houseId,
      }),
      {
        invitationId,
        auditId: '01941f29-7c00-7000-8000-000000000902',
        command: { kind: 'shared' },
        tokenDigestHex: invitationDigest,
        createdAt: clock.now(),
        deliveryEvent: null,
      },
    );
    await database.query(
      `insert into games
        (id, house_id, season_id, mode, state, black_membership_id, clock_policy, created_at)
       values ($1, $2, $3, 'correspondence', 'waiting', $4,
               '{"kind":"correspondence","perMoveHours":24}', $5)`,
      [
        waitingGameId,
        world.first.houseId,
        seasonId,
        world.first.nonOwner.membershipId,
        clock.now(),
      ],
    );
    await database.query(
      `insert into open_seats
        (id, game_id, house_id, offered_color, creator_membership_id, state, expires_at, created_at)
       values ($1, $2, $3, 'white', $4, 'open', $5, $6)`,
      [
        waitingSeatId,
        waitingGameId,
        world.first.houseId,
        world.first.nonOwner.membershipId,
        new Date('2026-09-08T10:00:00.000Z'),
        clock.now(),
      ],
    );
    await database.query(
      `insert into games
        (id, house_id, season_id, mode, state, white_membership_id, black_membership_id,
         clock_policy, move_due_at, created_at)
       values ($1, $2, $3, 'correspondence', 'active', $4, $5,
               '{"kind":"correspondence","perMoveHours":24}', $6, $6)`,
      [
        activeGameId,
        world.first.houseId,
        seasonId,
        world.first.member.membershipId,
        world.first.nonOwner.membershipId,
        clock.now(),
      ],
    );
    harness = {
      world,
      authorizeHouseAction,
      clock,
      ids,
      tokens,
      invitations,
      invitationEmail: {
        codec: {
          seal: async () => 'sealed-invitation',
          open: async () => {
            throw new Error('Invitation delivery is not read in isolation tests');
          },
        },
        buildUrl: (rawToken) => `https://betweenmoves.test/invitations/${rawToken}`,
      },
      redemptions: new PgInvitationRedemptionRepository(database),
      memberships: new PgMembershipAdminRepository(database),
      attendance: new PgNightAttendanceRepository(database),
      events: { record: () => undefined },
      joinLeave: { record: () => undefined },
      nights: new PgNightRepository(database),
      lifecycle,
      presence: {
        read: async () => ({ members: [] }),
        enter: async () => ({ members: [] }),
        leave: async () => ({ members: [] }),
      },
      rsvps: new PgNightRsvpRepository(database),
      lifecycleChanges: { record: () => undefined },
      acceptances: new PgGameSeatAcceptanceRepository(database),
      seats: new PgGameSeatRepository(database),
      changes: { record: () => undefined },
      seasons,
      transitions: { record: () => undefined },
      moves: new PgSubmitMoveRepository(database),
      completions: new PgGameCompletionRepository(database),
      reactions: new PgGameReactionRepository(database),
      notes: new PgGameNoteRepository(database),
      rules: {
        applyMove: () => {
          throw new Error('Cross-House Move must not reach the rules adapter');
        },
      },
    };
  });

  afterAll(async () => {
    await migrateDown(database, { migrationsDirectory, all: true });
    await database.end();
  });

  it.each(cases)('[BM-017] [DR-MEM-04] denies or scopes $name ($id)', async (testCase) => {
    const firstBefore = await houseState(database, harness.world.first.houseId);
    const secondBefore = await houseState(database, harness.world.second.houseId);

    if (testCase.outcome === 'denied') {
      await expect(testCase.run(harness)).rejects.toMatchObject(testCase.expectedError ?? {});
      await expect(houseState(database, harness.world.first.houseId)).resolves.toEqual(firstBefore);
      await expect(houseState(database, harness.world.second.houseId)).resolves.toEqual(
        secondBefore,
      );
      return;
    }

    await expect(testCase.run(harness)).resolves.toMatchObject({
      houseId: harness.world.first.houseId,
    });
    await expect(houseState(database, harness.world.first.houseId)).resolves.not.toEqual(
      firstBefore,
    );
    await expect(houseState(database, harness.world.second.houseId)).resolves.toEqual(secondBefore);
  });

  it('[BM-017] switches one session between independent House capability contexts', async () => {
    const switchingViewer = viewer(harness.world.switchingMember);
    const firstBefore = await houseState(database, harness.world.first.houseId);
    const secondBefore = await houseState(database, harness.world.second.houseId);
    const scopedTokens = {
      issue: () => ({
        raw: 'bm-017-switching-member-first-house-token',
        digestHex: 'd'.repeat(64),
      }),
    };

    await expect(
      createInvitation(
        {
          houseId: harness.world.first.houseId,
          command: { kind: 'shared' },
          idempotencyKey: null,
          viewer: switchingViewer,
        },
        { ...harness, tokens: scopedTokens },
      ),
    ).resolves.toMatchObject({ houseId: harness.world.first.houseId });
    await expect(houseState(database, harness.world.first.houseId)).resolves.not.toEqual(
      firstBefore,
    );

    await expect(
      createInvitation(
        {
          houseId: harness.world.second.houseId,
          command: { kind: 'shared' },
          idempotencyKey: null,
          viewer: switchingViewer,
        },
        { ...harness, tokens: scopedTokens },
      ),
    ).rejects.toMatchObject({
      code: 'authorization_denied',
      reason: 'role_not_permitted',
      crossHouse: false,
    });
    await expect(houseState(database, harness.world.second.houseId)).resolves.toEqual(secondBefore);
  });
});
