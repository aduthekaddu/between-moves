import {
  DomainError,
  type ChangeNightScheduleRequest,
  type NightChangeResult,
  type NightDependencies,
  type ReadScheduledNightsRequest,
} from '@between-moves/domain';

function recordChange(
  dependencies: NightDependencies,
  observation: Parameters<NightDependencies['changes']['record']>[0],
): void {
  try {
    dependencies.changes.record(observation);
  } catch {
    // Diagnostics never alter the committed Night schedule outcome.
  }
}

function validateInterval(scheduledStart: Date, scheduledEnd: Date): void {
  if (
    Number.isNaN(scheduledStart.getTime()) ||
    Number.isNaN(scheduledEnd.getTime()) ||
    scheduledEnd <= scheduledStart
  ) {
    throw new DomainError('validation_failed', 'Night end must be after its start');
  }
}

/** [BM-020] [DR-NIGHT-03] Reschedule or cancel one authorized House Night. */
export async function changeNightSchedule(
  request: ChangeNightScheduleRequest,
  dependencies: NightDependencies,
): Promise<NightChangeResult> {
  const context = await dependencies.authorizeHouseAction(
    { kind: 'schedule_night' },
    request.houseId,
    request.viewer,
  );
  if (request.command.kind === 'reschedule') {
    validateInterval(request.command.scheduledStart, request.command.scheduledEnd);
  }
  const change = request.command.kind === 'cancel' ? 'cancelled' : 'rescheduled';
  const actorId = request.viewer.kind === 'authenticated' ? request.viewer.userId : 'anonymous';
  try {
    const result = await dependencies.nights.change(context, {
      nightId: request.nightId,
      auditId: dependencies.ids.generate(),
      command: request.command,
      changedAt: dependencies.clock.now(),
    });
    if (result.changedNow) {
      recordChange(dependencies, {
        actorId,
        houseId: request.houseId,
        nightId: request.nightId,
        change,
        outcome: 'success',
      });
    }
    return result;
  } catch (error) {
    recordChange(dependencies, {
      actorId,
      houseId: request.houseId,
      nightId: request.nightId,
      change,
      outcome: error instanceof DomainError ? 'rejected' : 'error',
    });
    throw error;
  }
}

/** [BM-020] [DR-PERM-01] Read the current House's scheduled and cancelled Nights. */
export async function readScheduledNights(
  request: ReadScheduledNightsRequest,
  dependencies: Pick<NightDependencies, 'authorizeHouseAction' | 'nights'>,
) {
  const context = await dependencies.authorizeHouseAction(
    { kind: 'view_house_content' },
    request.houseId,
    request.viewer,
  );
  return dependencies.nights.list(context);
}
