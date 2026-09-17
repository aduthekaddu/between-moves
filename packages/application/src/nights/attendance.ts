import {
  DomainError,
  type NightAttendanceDependencies,
  type NightAttendanceJoinResult,
  type NightAttendanceLeaveResult,
  type NightAttendanceRequest,
  type NightJoinLeaveKind,
  type NightJoinLeaveObservation,
} from '@between-moves/domain';

async function authorize(
  request: NightAttendanceRequest,
  dependencies: NightAttendanceDependencies,
) {
  return dependencies.authorizeHouseAction(
    { kind: 'view_house_content' },
    request.houseId,
    request.viewer,
  );
}

function actorId(request: NightAttendanceRequest): string {
  return request.viewer.kind === 'authenticated' ? request.viewer.userId : 'anonymous';
}

function recordJoinLeave(
  dependencies: NightAttendanceDependencies,
  observation: NightJoinLeaveObservation,
): void {
  try {
    dependencies.joinLeave.record(observation);
  } catch {
    // Diagnostics never alter committed attendance or its scoring event.
  }
}

function recordQualification(
  request: NightAttendanceRequest,
  result: NightAttendanceLeaveResult,
  dependencies: NightAttendanceDependencies,
): void {
  if (!result.scoringEventEmitted || result.sourceKey === null) return;
  try {
    dependencies.events.record({
      actorId: actorId(request),
      attendanceId: result.attendanceId,
      houseId: result.houseId,
      nightId: result.nightId,
      sourceKey: result.sourceKey,
    });
  } catch {
    // Diagnostics never alter committed attendance or its scoring event.
  }
}

async function observeJoinLeave<T>(
  request: NightAttendanceRequest,
  change: NightJoinLeaveKind,
  dependencies: NightAttendanceDependencies,
  operation: () => Promise<T>,
  changed: (result: T) => { readonly attendanceId: string } | null,
): Promise<T> {
  const observation = {
    actorId: actorId(request),
    houseId: request.houseId,
    nightId: request.nightId,
    change,
  };
  try {
    const result = await operation();
    const recorded = changed(result);
    if (recorded !== null) {
      recordJoinLeave(dependencies, {
        ...observation,
        attendanceId: recorded.attendanceId,
        outcome: 'success',
      });
    }
    return result;
  } catch (error) {
    recordJoinLeave(dependencies, {
      ...observation,
      attendanceId: null,
      outcome: error instanceof DomainError ? 'rejected' : 'error',
    });
    throw error;
  }
}

/** [BM-036] [DR-NIGHT-02] Record a server-timestamped join and open one attendance interval. */
export async function joinNight(
  request: NightAttendanceRequest,
  dependencies: NightAttendanceDependencies,
): Promise<NightAttendanceJoinResult> {
  const context = await authorize(request, dependencies);
  return observeJoinLeave(
    request,
    'join',
    dependencies,
    () =>
      dependencies.attendance.join(context, {
        attendanceId: dependencies.ids.generate(),
        eventId: dependencies.ids.generate(),
        nightId: request.nightId,
        joinedAt: dependencies.clock.now(),
      }),
    (result) => (result.joinedNow ? result : null),
  );
}

/** [BM-036] [DR-NIGHT-02/05] Close an interval, accrue duration, and feed the BM-033 source. */
export async function leaveNight(
  request: NightAttendanceRequest,
  dependencies: NightAttendanceDependencies,
): Promise<NightAttendanceLeaveResult | null> {
  const context = await authorize(request, dependencies);
  const result = await observeJoinLeave(
    request,
    'leave',
    dependencies,
    () =>
      dependencies.attendance.leave(context, {
        nightId: request.nightId,
        eventId: dependencies.ids.generate(),
        scoringEventId: dependencies.ids.generate(),
        leftAt: dependencies.clock.now(),
      }),
    (leave) => (leave?.leftNow === true ? leave : null),
  );
  if (result !== null) recordQualification(request, result, dependencies);
  return result;
}
