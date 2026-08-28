/** [BM-003] Next.js invokes this once when each server instance starts. */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startApplication } = await import('./config/startup');

    try {
      startApplication();
    } catch {
      // Next.js reports instrumentation errors but may keep its listener alive.
      // A hard exit is required for the fail-closed startup contract.
      process.exit(1);
    }
  }
}
