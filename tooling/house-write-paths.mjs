/**
 * [BM-017] CI inventory for every current House-scoped write command.
 *
 * `house-id` paths take their authorization context from a House route parameter.
 * `invitation-token` derives the only writable House from the locked Invitation row.
 */
export const houseWritePaths = Object.freeze([
  {
    id: 'invitation.create',
    useCase: 'createInvitation',
    route: 'apps/web/src/app/api/houses/[houseId]/invitations/route.ts',
    scope: 'house-id',
  },
  {
    id: 'invitation.revoke',
    useCase: 'revokeInvitation',
    route: 'apps/web/src/app/api/houses/[houseId]/invitations/[invitationId]/revoke/route.ts',
    scope: 'house-id',
  },
  {
    id: 'invitation.redeem',
    useCase: 'redeemInvitation',
    route: 'apps/web/src/app/api/invitations/[token]/redeem/route.ts',
    scope: 'invitation-token',
  },
  {
    id: 'membership.change-role',
    useCase: 'changeMembershipRole',
    route: 'apps/web/src/app/api/houses/[houseId]/members/[membershipId]/role/route.ts',
    scope: 'house-id',
  },
  {
    id: 'membership.remove',
    useCase: 'removeHouseMember',
    route: 'apps/web/src/app/api/houses/[houseId]/members/[membershipId]/remove/route.ts',
    scope: 'house-id',
  },
  {
    id: 'membership.leave',
    useCase: 'leaveHouse',
    route: 'apps/web/src/app/api/houses/[houseId]/leave/route.ts',
    scope: 'house-id',
  },
  {
    id: 'ownership.transfer',
    useCase: 'transferHouseOwnership',
    route: 'apps/web/src/app/api/houses/[houseId]/transfer/route.ts',
    scope: 'house-id',
  },
  {
    id: 'season.draft',
    useCase: 'draftSeason',
    route: 'apps/web/src/app/api/houses/[houseId]/seasons/route.ts',
    scope: 'house-id',
  },
  {
    id: 'season.charter',
    useCase: 'draftSeasonCharter',
    route: 'apps/web/src/app/api/houses/[houseId]/seasons/[seasonId]/charter/route.ts',
    scope: 'house-id',
  },
  {
    id: 'season.publish',
    useCase: 'publishSeason',
    route: 'apps/web/src/app/api/houses/[houseId]/seasons/[seasonId]/publish/route.ts',
    scope: 'house-id',
  },
  {
    id: 'night.schedule-change',
    useCase: 'changeNightSchedule',
    route: 'apps/web/src/app/api/houses/[houseId]/nights/[nightId]/route.ts',
    scope: 'house-id',
  },
  {
    id: 'night.start',
    useCase: 'startNight',
    route: 'apps/web/src/app/api/houses/[houseId]/nights/[nightId]/start/route.ts',
    scope: 'house-id',
  },
  {
    id: 'night.end',
    useCase: 'endNight',
    route: 'apps/web/src/app/api/houses/[houseId]/nights/[nightId]/end/route.ts',
    scope: 'house-id',
  },
  {
    id: 'night.host-assign',
    useCase: 'assignNightHost',
    route: 'apps/web/src/app/api/houses/[houseId]/nights/[nightId]/host/route.ts',
    scope: 'house-id',
  },
  {
    id: 'night.rsvp',
    useCase: 'rsvpNight',
    route: 'apps/web/src/app/api/houses/[houseId]/nights/[nightId]/rsvp/route.ts',
    scope: 'house-id',
  },
  {
    id: 'night.attendance-join',
    useCase: 'joinNight',
    route: 'apps/web/src/app/api/houses/[houseId]/nights/[nightId]/join/route.ts',
    scope: 'house-id',
  },
  {
    id: 'night.attendance-leave',
    useCase: 'leaveNight',
    route: 'apps/web/src/app/api/houses/[houseId]/nights/[nightId]/leave/route.ts',
    scope: 'house-id',
  },
  {
    id: 'night.presence-change',
    useCase: 'changeNightPresence',
    route: 'apps/web/src/app/api/houses/[houseId]/nights/[nightId]/presence/route.ts',
    scope: 'house-id',
  },
  {
    id: 'game.seat-create',
    useCase: 'createGameSeat',
    route: 'apps/web/src/app/api/houses/[houseId]/games/route.ts',
    scope: 'house-id',
  },
  {
    id: 'game.seat-accept',
    useCase: 'acceptGameSeat',
    route: 'apps/web/src/app/api/houses/[houseId]/games/[gameId]/accept/route.ts',
    scope: 'house-id',
  },
  {
    id: 'game.move-submit',
    useCase: 'submitMove',
    route: 'apps/web/src/app/api/houses/[houseId]/games/[gameId]/moves/route.ts',
    scope: 'house-id',
  },
  {
    id: 'game.resign',
    useCase: 'resignGame',
    route: 'apps/web/src/app/api/houses/[houseId]/games/[gameId]/resign/route.ts',
    scope: 'house-id',
  },
  {
    id: 'game.draw',
    useCase: 'handleDraw',
    route: 'apps/web/src/app/api/houses/[houseId]/games/[gameId]/draw/route.ts',
    scope: 'house-id',
  },
  {
    id: 'game.reaction-set',
    useCase: 'setGameReaction',
    route: 'apps/web/src/app/api/houses/[houseId]/games/[gameId]/reactions/route.ts',
    scope: 'house-id',
  },
  {
    id: 'game.note-save',
    useCase: 'saveGameNote',
    route: 'apps/web/src/app/api/houses/[houseId]/games/[gameId]/note/route.ts',
    scope: 'house-id',
  },
  {
    id: 'night.chat-post',
    useCase: 'postHouseChat',
    route: 'apps/web/src/app/api/houses/[houseId]/nights/[nightId]/chat/route.ts',
    scope: 'house-id',
  },
  {
    id: 'night.chat-delete',
    useCase: 'deleteHouseChat',
    route: 'apps/web/src/app/api/houses/[houseId]/nights/[nightId]/chat/[messageId]/route.ts',
    scope: 'house-id',
  },
]);

/** Runtime House exports which do not mutate an existing House. */
export const nonHouseWriteExports = Object.freeze([
  'createAuthorizeHouseAction',
  'createHouse',
  'inspectInvitation',
  'readHouseSeason',
  'readSeasonStandings',
  'createSeasonScoringConsumer',
  'readHouseHome',
  'readGamePosition',
  'readMoveShelf',
  'readScheduledNights',
  'readNightHostCandidates',
  'mintRealtimeToken',
  'readNightRail',
  'readHouseChat',
  'readCurrentGameReaction',
  'readGameNotes',
]);

/** POST routes which do not mutate an existing House. */
export const nonHouseMutationRoutes = Object.freeze([
  'apps/web/src/app/api/auth/[...all]/route.ts',
  'apps/web/src/app/api/auth/magic-link/route.ts',
  'apps/web/src/app/api/auth/recovery/route.ts',
  'apps/web/src/app/api/houses/route.ts',
  'apps/web/src/app/api/houses/[houseId]/games/[gameId]/realtime-token/route.ts',
  'apps/web/src/app/api/houses/[houseId]/nights/[nightId]/realtime-token/route.ts',
  'apps/web/src/app/api/webhooks/resend/route.ts',
  'apps/web/src/app/api/internal/realtime/publish/route.ts',
]);
