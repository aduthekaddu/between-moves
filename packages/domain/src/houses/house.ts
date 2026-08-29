import type { Clock } from '../shared/clock';
import { DomainError } from '../shared/errors';

const MAX_HOUSE_NAME_LENGTH = 80;
const MAX_HOUSE_DESCRIPTION_LENGTH = 500;

export interface CreateHouseCommand {
  readonly name: string;
  readonly timeZone: string;
  readonly description?: string | null;
}

export interface ValidatedCreateHouseCommand {
  readonly name: string;
  readonly timeZone: string;
  readonly description: string | null;
}

export interface IdGenerator {
  generate(): string;
}

export interface HouseCreationInput extends ValidatedCreateHouseCommand {
  readonly houseId: string;
  readonly ownerMembershipId: string;
  readonly auditId: string;
  readonly ownerUserId: string;
  readonly slug: string;
  readonly emblemSeed: string;
  readonly createdAt: Date;
}

export interface HouseCreationResult {
  readonly houseId: string;
  readonly ownerMembershipId: string;
  readonly slug: string;
  readonly emblemSeed: string;
  readonly timeZone: string;
}

export interface HouseCreationRepository {
  create(input: HouseCreationInput): Promise<HouseCreationResult>;
}

export interface HouseCreationDependencies {
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly houses: HouseCreationRepository;
}

function validation(message: string): never {
  throw new DomainError('validation_failed', message);
}

function canonicalTimeZone(value: string): string {
  const timeZone = value.trim();
  if (timeZone.length === 0 || /^[+-]/.test(timeZone)) {
    validation('House time zone must be an IANA name');
  }
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone }).resolvedOptions().timeZone;
  } catch {
    return validation('House time zone must be an IANA name');
  }
}

/** [BM-011] [DR-HOUSE-01] Validate server-authoritative House creation input. */
export function validateCreateHouseCommand(
  command: CreateHouseCommand,
): ValidatedCreateHouseCommand {
  const name = command.name.trim();
  if (name.length < 1 || name.length > MAX_HOUSE_NAME_LENGTH) {
    validation('House name must contain between 1 and 80 characters');
  }

  const description = command.description?.trim() || null;
  if (description !== null && description.length > MAX_HOUSE_DESCRIPTION_LENGTH) {
    validation('House description must contain at most 500 characters');
  }

  return { name, description, timeZone: canonicalTimeZone(command.timeZone) };
}

/** Slugs are opaque route identifiers, generated only from server-owned House identity. */
export function createHouseSlug(houseId: string): string {
  return houseId;
}

/** [BM-011] [UX-IMG-01] Stable seed; rendering can evolve without an upload surface. */
export function createHouseEmblemSeed(houseId: string): string {
  return `house:${houseId}`;
}
