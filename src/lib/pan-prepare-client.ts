import type { PanPlayback, PanPrepareEvent, PanProgress, PanProvider } from './netdisk-types';
import { PanRequestError } from '@/components/pan-accounts';
export async function preparePanPlayback(provider: PanProvider, key: string, replaceLease: string | undefined, progress: (v: PanProgress) => void): Promise<PanPlayback> {
  const operation = crypto.randomUUID();
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch('/api/netdisk/prepare', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider, key, saveConsent: true, replaceLease, operation }) });
      if (!response.ok || !response.body) { if (response.status === 401) window.dispatchEvent(new CustomEvent('libretv:unauthorized')); const error = await response.json().catch(() => ({})); throw new PanRequestError(error.error || '播放准备暂不可用', error.code || 'PREPARE_REJECTED'); }
      const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = ''; let playback: PanPlayback | undefined;
      const consume = (line: string) => { if (!line.trim()) return; const event = JSON.parse(line) as PanPrepareEvent; if (event.type === 'progress') progress(event.value); if (event.type === 'ready') playback = event.playback; if (event.type === 'error') throw new PanRequestError(event.error, event.code || 'PREPARE_FAILED'); };
      try { for (;;) { const { done, value } = await reader.read(); if (done) break; buffer += decoder.decode(value, { stream: true }); let i: number; while ((i = buffer.indexOf('\n')) >= 0) { consume(buffer.slice(0, i)); buffer = buffer.slice(i + 1); } } consume(buffer + decoder.decode()); }
      finally { await reader.cancel().catch(() => {}); }
      if (playback) return playback;
    } catch (e) { if (e instanceof PanRequestError) throw e; if (attempt === 1) throw new Error('播放准备连接中断，请重新打开准备窗口检查；已提交的转存会复用'); }
    progress({ stage: 'queued', message: '连接中断，正在恢复同一次播放准备状态…' });
  }
  throw new Error('暂时无法读取准备结果，请重新检查');
}
