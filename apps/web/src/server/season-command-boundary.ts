import {
  AuthenticationRequiredError,
  DomainError,
  HouseAuthorizationDeniedError,
  type AuthenticatedViewer,
} from '@between-moves/domain';
import { z, type ZodType } from 'zod';
import { problemResponse as problem, readJsonBody } from '../kernel/request';

const MAXIMUM_BODY_BYTES = 4_096;
const identifierSchema = z.string().uuid();

export const draftSeasonBodySchema = z
  .object({ title: z.string().trim().min(1).max(80).optional() })
  .strict();

export const seasonIdempotencyKeySchema = z.string().trim().min(1).max(128);

export const charterBodySchema = z
  .object({
    correspondencePaceHours: z.number().int().positive().max(2_147_483_647),
    nightRecurrence: z
      .object({
        weekday: z.number().int().min(0).max(6),
        localTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
        count: z.literal(4),
      })
      .strict(),
  })
  .strict();

const fourWeeksMs = 28 * 24 * 60 * 60 * 1_000;
export const publishSeasonBodySchema = z
  .object({
    title: z.string().trim().min(1).max(80),
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime(),
  })
  .strict()
  .superRefine((value, context) => {
    const startsAt = Date.parse(value.startsAt);
    const endsAt = Date.parse(value.endsAt);
    if (!Number.isNaN(startsAt) && !Number.isNaN(endsAt) && endsAt - startsAt !== fourWeeksMs) {
      context.addIssue({
        code: 'custom',
        path: ['endsAt'],
        message: 'Season end must be exactly four weeks after its start.',
      });
    }
  });

export interface SeasonBoundaryDependencies {
  readonly expectedOrigin: string;
  readonly requireViewer: (request: Request) => Promise<AuthenticatedViewer>;
}

export type SeasonBoundaryResult =
  | { readonly kind: 'ok'; readonly viewer: AuthenticatedViewer }
  | { readonly kind: 'response'; readonly response: Response };

export async function resolveSeasonBoundary(
  dependencies: SeasonBoundaryDependencies,
  request: Request,
  houseId: string,
  seasonId?: string,
): Promise<SeasonBoundaryResult> {
  if (request.headers.get('origin') !== dependencies.expectedOrigin) {
    return {
      kind: 'response',
      response: problem(
        request,
        403,
        'origin_rejected',
        'Origin rejected',
        'Request origin is not allowed.',
      ),
    };
  }
  if (
    !identifierSchema.safeParse(houseId).success ||
    (seasonId !== undefined && !identifierSchema.safeParse(seasonId).success)
  ) {
    return {
      kind: 'response',
      response: validationProblem(request, { _form: ['Season route is invalid.'] }),
    };
  }
  try {
    return { kind: 'ok', viewer: await dependencies.requireViewer(request) };
  } catch (error) {
    if (!(error instanceof AuthenticationRequiredError)) throw error;
    return {
      kind: 'response',
      response: problem(
        request,
        401,
        'unauthenticated',
        'Authentication required',
        'Sign in to manage this Season.',
      ),
    };
  }
}

function zodFieldErrors(error: z.ZodError): Record<string, string[]> {
  const fields: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const path = issue.path.join('.');
    const keys =
      issue.code === 'unrecognized_keys'
        ? issue.keys.map((key) => (path.length > 0 ? `${path}.${key}` : key))
        : [path || '_form'];
    for (const key of keys) (fields[key] ??= []).push(issue.message);
  }
  return fields;
}

export async function parseSeasonBody<T>(
  request: Request,
  schema: ZodType<T>,
): Promise<
  | { readonly kind: 'ok'; readonly data: T }
  | { readonly kind: 'response'; readonly response: Response }
> {
  const body = await readJsonBody(request, MAXIMUM_BODY_BYTES);
  if (body.kind === 'too_large') {
    return {
      kind: 'response',
      response: problem(
        request,
        413,
        'payload_too_large',
        'Payload too large',
        'Charter details are too large.',
      ),
    };
  }
  if (body.kind === 'invalid') {
    return {
      kind: 'response',
      response: validationProblem(request, { _form: ['Charter details are invalid.'] }),
    };
  }
  const parsed = schema.safeParse(body.value);
  return parsed.success
    ? { kind: 'ok', data: parsed.data }
    : { kind: 'response', response: validationProblem(request, zodFieldErrors(parsed.error)) };
}

export function validationProblem(request: Request, errors: Record<string, string[]>): Response {
  return Response.json(
    {
      type: 'https://betweenmoves.app/problems/validation_failed',
      title: 'Validation failed',
      status: 422,
      code: 'validation_failed',
      detail: 'Charter details are invalid.',
      instance: new URL(request.url).pathname,
      errors,
    },
    {
      status: 422,
      headers: { 'Cache-Control': 'private, no-store', 'Content-Type': 'application/problem+json' },
    },
  );
}

export function seasonCommandError(request: Request, error: unknown): Response | null {
  if (error instanceof HouseAuthorizationDeniedError) {
    return problem(
      request,
      403,
      'forbidden',
      'Forbidden',
      'Only an Owner or Steward can manage a Charter.',
    );
  }
  if (!(error instanceof DomainError)) return null;
  if (error.code === 'validation_failed')
    return validationProblem(request, { _form: [error.message] });
  if (error.code === 'not_found')
    return problem(request, 404, 'not_found', 'Not found', 'Season is unavailable.');
  if (error.code === 'conflict')
    return problem(request, 409, 'season_conflict', 'Season conflict', error.message);
  if (error.code === 'idempotency_conflict') {
    return problem(
      request,
      409,
      'idempotency_conflict',
      'Idempotency conflict',
      'The Idempotency-Key was already used for another Season draft.',
    );
  }
  if (error.code === 'authorization_denied') {
    return problem(
      request,
      403,
      'forbidden',
      'Forbidden',
      'Only an Owner or Steward can manage a Charter.',
    );
  }
  return null;
}
