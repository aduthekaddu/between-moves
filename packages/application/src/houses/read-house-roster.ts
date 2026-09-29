import type {
  HouseRoster,
  PendingInvitation,
  ReadHouseRosterDependencies,
  ReadHouseRosterQuery,
  ReadPendingInvitationsDependencies,
} from '@between-moves/domain';

/** [BM-015] [DR-MEM-04] Any active Member may see who else is in their House. */
export async function readHouseRoster(
  query: ReadHouseRosterQuery,
  dependencies: ReadHouseRosterDependencies,
): Promise<HouseRoster | null> {
  const context = await dependencies.authorizeHouseAction(
    { kind: 'view_house_content' },
    query.houseId,
    query.viewer,
  );
  return dependencies.roster.readRoster(context);
}

/** [BM-014] Only those who may invite (Owner and Stewards) see the Invitations still open. */
export async function readPendingInvitations(
  query: ReadHouseRosterQuery,
  dependencies: ReadPendingInvitationsDependencies,
): Promise<readonly PendingInvitation[]> {
  const context = await dependencies.authorizeHouseAction(
    { kind: 'create_member_invite' },
    query.houseId,
    query.viewer,
  );
  return dependencies.invitations.listPending(context, dependencies.clock.now());
}
