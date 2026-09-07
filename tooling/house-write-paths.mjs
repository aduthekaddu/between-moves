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
]);

/** Runtime House exports which do not mutate an existing House. */
export const nonHouseWriteExports = Object.freeze([
  'createAuthorizeHouseAction',
  'createHouse',
  'inspectInvitation',
  'readHouseSeason',
  'readHouseHome',
  'readMoveShelf',
  'readScheduledNights',
]);

/** Mutating API routes which do not act on an existing House. */
export const nonHouseMutationRoutes = Object.freeze([
  'apps/web/src/app/api/auth/[...all]/route.ts',
  'apps/web/src/app/api/auth/magic-link/route.ts',
  'apps/web/src/app/api/auth/recovery/route.ts',
  'apps/web/src/app/api/houses/route.ts',
]);
