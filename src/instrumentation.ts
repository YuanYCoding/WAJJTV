export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.NODE_ENV !== 'test') {
    const { startSourceMonitor } = await import('./lib/source-health-server');
    startSourceMonitor();
  }
}
