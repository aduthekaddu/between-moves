import type { Viewer } from '../identity';
import type { AuthorizationContext } from '../shared/authorization-context';
import type { AuthorizeHouseAction, MembershipRole } from './authorization';

/** [BM-013] [DR-HOUSE-01] Member-visible House identity for the House home. */
export interface HouseHome {
  readonly houseId: string;
  readonly name: string;
  readonly description: string | null;
  readonly emblemSeed: string;
  readonly timeZone: string;
  readonly membershipRole: MembershipRole;
}

/** [BM-013] [DR-MEM-04] A House home read requires a House-issued context. */
export interface HouseHomeReadRepository {
  read(context: AuthorizationContext): Promise<HouseHome | null>;
}

export interface ReadHouseHomeQuery {
  readonly houseId: string;
  readonly viewer: Viewer;
}

export interface ReadHouseHomeDependencies {
  readonly authorizeHouseAction: AuthorizeHouseAction;
  readonly houses: HouseHomeReadRepository;
}
