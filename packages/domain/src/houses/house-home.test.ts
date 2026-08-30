import { describe, expectTypeOf, it } from 'vitest';
import type { AuthorizationContext } from '../shared/authorization-context';
import type { HouseHomeReadRepository } from './house-home';

function bareReadMustNotCompile(repository: HouseHomeReadRepository): void {
  // @ts-expect-error [BM-013] A House home read requires an authorization context.
  void repository.read();
}

describe('House home repository authorization contract', () => {
  it('[BM-013] [DR-MEM-04] requires a House AuthorizationContext', () => {
    expectTypeOf<HouseHomeReadRepository['read']>().parameters.toEqualTypeOf<
      [AuthorizationContext]
    >();
    expectTypeOf(bareReadMustNotCompile).toBeFunction();
  });
});
