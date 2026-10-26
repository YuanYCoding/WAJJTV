/** Pure, shared circuit-breaker policy. An expired cooldown NEVER restores a source. */
export const HEALTHY_INTERVAL = 15 * 60_000;
export const RECOVERY_DELAYS = [5, 15, 30, 60].map((n) => n * 60_000);
export interface SourceHealth {
  status: 'healthy' | 'suspect' | 'unavailable';
  failures: number;
  recoveryLevel: number;
  checkedAt: number;
  nextCheckAt: number;
  ms?: number;
  error?: string;
}
export function nextHealth(previous: SourceHealth | undefined, ok: boolean, ms?: number, error?: string, now = Date.now()): SourceHealth {
  if (ok) return { status: 'healthy', failures: 0, recoveryLevel: 0, checkedAt: now, nextCheckAt: now + HEALTHY_INTERVAL, ms };
  const failures = (previous?.failures || 0) + 1;
  const unavailable = failures >= 2 || previous?.status === 'unavailable';
  const level = previous?.status === 'unavailable' ? Math.min((previous.recoveryLevel || 0) + 1, RECOVERY_DELAYS.length - 1) : 0;
  return { status: unavailable ? 'unavailable' : 'suspect', failures, recoveryLevel: level, checkedAt: now, nextCheckAt: now + (unavailable ? RECOVERY_DELAYS[level] : 60_000), ms, error };
}

/** Only identical endpoints share identity: mirrors can have different availability/catalogues. */
export function sourceIdentity(raw: string): string {
  try {
    const u = new URL(raw);
    return `${u.origin}${u.pathname.replace(/\/+$/, '')}${u.search}`;
  } catch { return raw; }
}
