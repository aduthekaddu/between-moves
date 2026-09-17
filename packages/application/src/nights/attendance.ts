import type {
  NightAttendance,
  NightAttendanceDependencies,
  NightAttendanceLeaveResult,
  NightAttendanceRequest,
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

/** [BM-033] [DR-NIGHT-02] Start one server-timestamped durable attendance interval. */
export async function joinNight(
  request: NightAttendanceRequest,
  dependencies: NightAttendanceDependencies,
): Promise<NightAttendance> {
  const context = await authorize(request, dependencies);
  return dependencies.attendance.join(context, {
    attendanceId: dependencies.ids.generate(),
    nightId: request.nightId,
    joinedAt: dependencies.clock.now(),
  });
}

function recordQualification(
  request: NightAttendanceRequest,
  result: NightAttendanceLeaveResult,
  dependencies: NightAttendanceDependencies,
): void {
  if (!result.scoringEventEmitted || result.sourceKey === null) return;
  try {
    dependencies.events.record({
      actorId: request.viewer.kind === 'authenticated' ? request.viewer.userId : 'anonymous',
      attendanceId: result.attendanceId,
      houseId: result.houseId,
      nightId: result.nightId,
      sourceKey: result.sourceKey,
    });
  } catch {
    // Diagnostics never alter committed attendance or its scoring event.
  }
}

/** [BM-033] [DR-NIGHT-02/05] Close an interval and signal its first threshold crossing. */
export async function leaveNight(
  request: NightAttendanceRequest,
  dependencies: NightAttendanceDependencies,
): Promise<NightAttendanceLeaveResult | null> {
  const context = await authorize(request, dependencies);
  const result = await dependencies.attendance.leave(context, {
    nightId: request.nightId,
    scoringEventId: dependencies.ids.generate(),
    leftAt: dependencies.clock.now(),
  });
  if (result !== null) recordQualification(request, result, dependencies);
  return result;
}
