import type { HouseSeasonView } from '@between-moves/domain';

/** The publish command accepts only a Season of exactly four weeks. */
const SEASON_MS = 28 * 86_400_000;

/** What an Owner or Steward chooses when they open a Season. Dates are `YYYY-MM-DD`. */
export interface SeasonOpening {
  readonly title: string;
  readonly startDate: string;
  readonly paceHours: number;
  readonly weekday: number;
  readonly localTime: string;
}

/** How far an earlier attempt got, so a retry skips the steps the server already took. */
export interface SeasonOpeningProgress {
  readonly seasonId: string | undefined;
  readonly charterVersioned: boolean;
}

export interface ProblemDetails {
  readonly detail?: string;
  readonly errors?: Record<string, string[]>;
}

function utcMidnight(date: string): number {
  return Date.parse(`${date}T00:00:00.000Z`);
}

/** The calendar date the House's own clock shows at `at`. */
export function houseLocalDate(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/** The last day of a Season that starts on `startDate`, or null for a date that is not one. */
export function seasonEndDate(startDate: string): string | null {
  const start = utcMidnight(startDate);
  if (Number.isNaN(start)) return null;
  return new Date(start + SEASON_MS).toISOString().slice(0, 10);
}

/** A date the way the Season page writes it, such as "2 December 2026". */
export function formatSeasonDate(date: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(utcMidnight(date));
}

/** A stored Season day the way people say it, such as "5 Nov 2026". */
export function seasonDayLabel(day: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(day);
}

/**
 * The values a new Season starts from: the draft's own where it has them, otherwise a Season
 * named for this month that starts today.
 */
export function seasonOpeningFor(
  draft: HouseSeasonView | null,
  today: string,
): { readonly initial: SeasonOpening; readonly progress: SeasonOpeningProgress } {
  const charter = draft?.charter ?? null;
  const month = new Intl.DateTimeFormat('en-GB', { month: 'long', timeZone: 'UTC' }).format(
    utcMidnight(today),
  );
  return {
    initial: {
      title: draft?.title ?? `${month} Season`,
      startDate: today,
      paceHours: charter?.correspondencePaceHours ?? 24,
      weekday: charter?.nightRecurrence.weekday ?? 5,
      localTime: charter?.nightRecurrence.localTime ?? '19:30',
    },
    progress: { seasonId: draft?.seasonId, charterVersioned: charter !== null },
  };
}

async function postJson(
  url: string,
  body: unknown,
  headers: Readonly<Record<string, string>> = {},
): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as Record<string, unknown> & ProblemDetails;
  if (!response.ok) throw payload;
  return payload;
}

/**
 * [BM-019] Draft the Season, version its Charter, then publish it. Each finished step is
 * reported through `onProgress`. A failed step throws the server's problem details.
 * Returns the published Charter version.
 */
export async function openSeason({
  houseId,
  opening,
  progress,
  draftIdempotencyKey,
  onProgress,
}: {
  readonly houseId: string;
  readonly opening: SeasonOpening;
  readonly progress: SeasonOpeningProgress;
  readonly draftIdempotencyKey: string;
  readonly onProgress: (progress: SeasonOpeningProgress) => void;
}): Promise<number> {
  let seasonId = progress.seasonId;
  if (seasonId === undefined) {
    const draft = await postJson(
      `/api/houses/${houseId}/seasons`,
      { title: opening.title },
      { 'Idempotency-Key': draftIdempotencyKey },
    );
    seasonId = String(draft.seasonId);
    onProgress({ seasonId, charterVersioned: false });
  }
  if (!progress.charterVersioned) {
    await postJson(`/api/houses/${houseId}/seasons/${seasonId}/charter`, {
      correspondencePaceHours: opening.paceHours,
      nightRecurrence: { weekday: opening.weekday, localTime: opening.localTime, count: 4 },
    });
    onProgress({ seasonId, charterVersioned: true });
  }
  const start = utcMidnight(opening.startDate);
  const active = await postJson(`/api/houses/${houseId}/seasons/${seasonId}/publish`, {
    title: opening.title,
    startsAt: new Date(start).toISOString(),
    endsAt: new Date(start + SEASON_MS).toISOString(),
  });
  return Number(active.publishedCharterVersion);
}
