export type NightState = 'scheduled' | 'live' | 'ended' | 'cancelled';
export type NightRsvpStatus = 'going' | 'not_going';

export interface HouseNightView {
  readonly nightId: string;
  readonly houseId: string;
  readonly seasonId: string;
  readonly scheduledStart: Date;
  readonly scheduledEnd: Date;
  readonly state: NightState;
  readonly hostMembershipId: string | null;
  readonly startedAt: Date | null;
  readonly endedAt: Date | null;
  readonly viewerIsHost: boolean;
  readonly viewerRsvp: NightRsvpStatus | null;
}
