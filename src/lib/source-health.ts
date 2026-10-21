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

/** Explicit provider aliases only. Other user-defined paths retain their identity. */
export function sourceIdentity(raw: string): string {
  try {
    const u = new URL(raw);
    const families = [
      ['modu', /(^|\.)(mdzyapi\.com|moduapi\.cc)$/],
      ['hongniu', /(^|\.)hongniuzy[23]\.com$/],
      ['jinying', /(^|\.)(jyzyapi\.com|jinyingzy\.com)$/],
      ['ffzy', /(^|\.)ffzyapi\.com$/],
      ['lzi', /(^|\.)lziapi\.com$/],
      ['360zy', /(^|\.)(360zy\.com|360zyzz\.com)$/],
      ['zuid', /(^|\.)(zuidapi\.com|zuidazy\.me)$/],
    ] as const;
    const family = families.find(([, pattern]) => pattern.test(u.hostname));
    return family?.[0] || `${u.host}${u.pathname.replace(/\/at\/json\/?$/, '').replace(/\/+$/, '')}${u.search}`;
  } catch { return raw; }
}
