'use client';
import { useEffect } from 'react';
import { useAuth } from './auth';
import { useAppStore } from '@/lib/store';
import { api } from '@/lib/client-api';
import type { SourceHealth } from '@/lib/source-health';

/** Server state is shared between devices; custom sources are rechecked while the app is open. */
export function SourceHealthMonitor() {
  const { verified } = useAuth();
  useEffect(() => {
    if (!verified) return;
    let alive = true;
    let busy = false;
    const tick = async () => {
      if (busy || !alive || document.visibilityState === 'hidden') return;
      busy = true;
      try {
        const s = useAppStore.getState();
        const sources = [...s.envSources, ...s.customAPIs].filter((v) => !v.isAdult).slice(0, 100);
        if (!sources.length) return;
        const res = await fetch('/api/source/health', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sources: sources.map(({ key, url }) => ({ key, url })) }) });
        if (!res.ok || !alive) return;
        const { entries } = await res.json() as { entries: { key: string; health: SourceHealth | null }[] };
        const health = { ...useAppStore.getState().sourceHealth };
        for (const { key, health: h } of entries) {
          if (!h || (health[key]?.timestamp || 0) > h.checkedAt) continue;
          health[key] = { ok: h.status === 'healthy', ms: h.ms, error: h.error, failStreak: h.failures, timestamp: h.checkedAt, disableCount: h.recoveryLevel, unavailable: h.status === 'unavailable', disabledUntil: h.status === 'unavailable' ? h.nextCheckAt : undefined };
        }
        useAppStore.setState({ sourceHealth: health });
        const custom = sources.filter((v) => s.customAPIs.some((c) => c.key === v.key) && (!health[v.key] || (health[v.key].disabledUntil || health[v.key].timestamp + 15 * 60_000) <= Date.now()));
        // Only two concurrent probes, independent of a user's search.
        let cursor = 0;
        await Promise.all(Array.from({ length: Math.min(2, custom.length) }, async () => {
          while (alive && cursor < custom.length) {
            const source = custom[cursor++];
            try {
              const r = await api.testSource(source.url);
              if (alive) useAppStore.getState().recordSourceHealth([{ sourceKey: source.key, ok: r.ok, ms: r.ms, error: r.error, list: [] }]);
            } catch { /* A failed app connection must not mark every source unavailable. */ }
          }
        }));
      } catch { /* Poll retries next minute; preserve last known state. */ }
      finally { busy = false; }
    };
    void tick();
    const timer = setInterval(() => void tick(), 60_000);
    document.addEventListener('visibilitychange', tick);
    return () => { alive = false; clearInterval(timer); document.removeEventListener('visibilitychange', tick); };
  }, [verified]);
  return null;
}
