import type {
  AuthorizationContext,
  AuthorizationContextInput,
} from '../shared/authorization-context';

/** [BM-005] Test-only context factory; production contexts are issued by House authorization. */
export function fakeAuthorizationContext(input: AuthorizationContextInput): AuthorizationContext {
  return input as AuthorizationContext;
}
