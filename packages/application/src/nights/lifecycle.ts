import {
  DomainError,
  type AssignNightHostRequest,
  type NightHostCandidate,
  type NightLifecycleDependencies,
  type NightLifecycleEvent,
  type NightLifecycleRequest,
  type NightLifecycleResult,
  type NightRsvp,
  type NightRsvpRequest,
  type ReadScheduledNightsRequest,
} from '@between-moves/domain';

function actorId(request: NightLifecycleRequest): string {
  return request.viewer.kind === 'authenticated' ? request.viewer.userId : 'anonymous';
}

function recordChange(
  dependencies: NightLifecycleDependencies,
  observation: Parameters<NightLifecycleDependencies['changes']['record']>[0],
): void {
  try {
    dependencies.changes.record(observation);
  } catch {
    // Diagnostics never alter the committed Night lifecycle outcome.
  }
}

async function observeLifecycle(
  request: NightLifecycleRequest,
  change: NightLifecycleEvent,
  dependencies: NightLifecycleDependencies,
  operation: () => Promise<NightLifecycleResult>,
): Promise<NightLifecycleResult> {
  const observation = {
    actorId: actorId(request),
    houseId: request.houseId,
    nightId: request.nightId,
    change,
  };
  try {
    const result = await operation();
    if (result.changedNow) {
      recordChange(dependencies, { ...observation, outcome: 'success' });
    }
    return result;
  } catch (error) {
    recordChange(dependencies, {
      ...observation,
      outcome: error instanceof DomainError ? 'rejected' : 'error',
    });
    throw error;
  }
}

async function authorizeStartOrEnd(
  request: NightLifecycleRequest,
  dependencies: NightLifecycleDependencies,
  operation: 'start' | 'end',
) {
  return dependencies.authorizeHouseAction(
    { kind: 'start_or_end_assigned_night', nightId: request.nightId, operation },
    request.houseId,
    request.viewer,
  );
}

/** [BM-035] [DR-NIGHT-03] Start an authorized House Night with server time. */
export async function startNight(
  request: NightLifecycleRequest,
  dependencies: NightLifecycleDependencies,
): Promise<NightLifecycleResult> {
  const context = await authorizeStartOrEnd(request, dependencies, 'start');
  return observeLifecycle(request, 'start', dependencies, () =>
    dependencies.lifecycle.start(context, {
      nightId: request.nightId,
      eventId: dependencies.ids.generate(),
      at: dependencies.clock.now(),
    }),
  );
}

/** [BM-035] [BM-036] [DR-NIGHT-03] End an authorized Night and settle its open attendance. */
export async function endNight(
  request: NightLifecycleRequest,
  dependencies: NightLifecycleDependencies,
): Promise<NightLifecycleResult> {
  const context = await authorizeStartOrEnd(request, dependencies, 'end');
  return observeLifecycle(request, 'end', dependencies, () =>
    dependencies.lifecycle.end(context, {
      nightId: request.nightId,
      eventId: dependencies.ids.generate(),
      at: dependencies.clock.now(),
      settlementIds: dependencies.ids,
    }),
  );
}

/** [BM-035] [DR-PERM-02] Assign a temporary Night host without a permanent role. */
export async function assignNightHost(
  request: AssignNightHostRequest,
  dependencies: NightLifecycleDependencies,
): Promise<NightLifecycleResult> {
  const context = await dependencies.authorizeHouseAction(
    { kind: 'schedule_night' },
    request.houseId,
    request.viewer,
  );
  return dependencies.lifecycle.assignHost(context, {
    nightId: request.nightId,
    hostMembershipId: request.hostMembershipId,
    assignedAt: dependencies.clock.now(),
  });
}

/** [BM-035] Active House Members available for temporary Night host duty. */
export async function readNightHostCandidates(
  request: ReadScheduledNightsRequest,
  dependencies: NightLifecycleDependencies,
): Promise<readonly NightHostCandidate[]> {
  const context = await dependencies.authorizeHouseAction(
    { kind: 'view_house_content' },
    request.houseId,
    request.viewer,
  );
  return dependencies.lifecycle.listHostCandidates(context);
}

/** [BM-035] Record one Member's RSVP with server-owned time. */
export async function rsvpNight(
  request: NightRsvpRequest,
  dependencies: NightLifecycleDependencies,
): Promise<NightRsvp> {
  const context = await dependencies.authorizeHouseAction(
    { kind: 'view_house_content' },
    request.houseId,
    request.viewer,
  );
  return dependencies.rsvps.rsvp(context, {
    rsvpId: dependencies.ids.generate(),
    nightId: request.nightId,
    status: request.status,
    respondedAt: dependencies.clock.now(),
  });
}
