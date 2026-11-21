import type {
  HouseRoster,
  HouseSeasonView,
  MoveShelf,
  OpenSeatListing,
} from '@between-moves/domain';

export type SetupStepId = 'invite' | 'season' | 'game';

export interface SetupStep {
  readonly id: SetupStepId;
  readonly done: boolean;
}

/**
 * What the House home shows above the games. Owners and Stewards get setup steps until the
 * House can play; a Member who joined gets one welcome until they play or dismiss it.
 */
export type HouseGuide =
  | { readonly kind: 'setup'; readonly steps: readonly SetupStep[] }
  | { readonly kind: 'welcome' }
  | { readonly kind: 'none' };

/** The cookie that remembers, per House and per device, that the welcome was dismissed. */
export function welcomeCookieName(houseId: string): string {
  return `bm-welcome-${houseId}`;
}

export function houseGuide({
  roster,
  season,
  shelf,
  openSeats,
  welcomeDismissed,
}: {
  readonly roster: HouseRoster;
  readonly season: HouseSeasonView | null;
  readonly shelf: MoveShelf;
  readonly openSeats: readonly OpenSeatListing[];
  readonly welcomeDismissed: boolean;
}): HouseGuide {
  const hasGames = shelf.yourMove.length + shelf.waiting.length + shelf.recent.length > 0;
  if (roster.viewerRole === 'member') {
    return hasGames || welcomeDismissed ? { kind: 'none' } : { kind: 'welcome' };
  }
  const steps: readonly SetupStep[] = [
    { id: 'invite', done: roster.members.length >= 2 },
    { id: 'season', done: season?.state === 'active' },
    { id: 'game', done: hasGames || openSeats.some((seat) => seat.viewerIsCreator) },
  ];
  return steps.every((step) => step.done) ? { kind: 'none' } : { kind: 'setup', steps };
}

const nightDays = [
  'Sundays',
  'Mondays',
  'Tuesdays',
  'Wednesdays',
  'Thursdays',
  'Fridays',
  'Saturdays',
];

/** When the weekly Night happens, such as "Fridays at 19:30". */
export function weeklyNight(weekday: number, localTime: string): string {
  return `${nightDays[weekday] ?? 'Every week'} at ${localTime}`;
}

/** The welcome's few plain facts, read from the active Season's Charter. */
export function welcomeLines(season: HouseSeasonView | null): readonly string[] {
  const points = 'Every game earns Season points. Most points at the end of the Season wins.';
  const charter = season?.state === 'active' ? season.charter : null;
  if (charter === null) return ['The Season has not started yet.', points];
  const hours = charter.correspondencePaceHours;
  const { weekday, localTime } = charter.nightRecurrence;
  return [
    `One move every ${hours === 1 ? 'hour' : `${hours} hours`}. Your games wait here.`,
    `${weeklyNight(weekday, localTime)}: live games and chat.`,
    points,
  ];
}
