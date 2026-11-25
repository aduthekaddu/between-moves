// Shared by eslint.config.mjs and apps/web/eslint.config.mjs. A test that reads the test
// database URL itself can skip when it is unset and still report green.
const testDatabaseVariable = '/^TEST_(RUNTIME_)?DATABASE_URL$/';
const message =
  'Get the test database with requireTestDatabaseUrl() from @between-moves/db/test-database. It fails when the database is missing; reading TEST_DATABASE_URL here lets a test skip and still pass.';

export const testDatabaseEnvRule = [
  'error',
  { selector: `Identifier[name=${testDatabaseVariable}]`, message },
  { selector: `Literal[value=${testDatabaseVariable}]`, message },
];
