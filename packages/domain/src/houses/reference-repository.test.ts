import { describe, expectTypeOf, it } from 'vitest';
import type { AuthorizationContext } from '../shared/authorization-context';
import type { HouseReferenceRepository } from './reference-repository';

function bareReadMustNotCompile(repository: HouseReferenceRepository): void {
  // @ts-expect-error [BM-005] DR-SEC-01 forbids repository reads without authorization context.
  void repository.list();
}

describe('House repository authorization contract', () => {
  it('[BM-005] DR-SEC-01 requires viewer and House AuthorizationContext for repository reads', () => {
    expectTypeOf<HouseReferenceRepository['list']>().parameters.toEqualTypeOf<
      [AuthorizationContext]
    >();
    expectTypeOf(bareReadMustNotCompile).toBeFunction();
  });
});
