import type { HlsConfig } from 'hls.js';
export type PlaybackMode = 'quality' | 'smooth';
export const PLAYBACK_MODE_KEY = 'jjbitv:playback-mode';
export function playbackMode(): PlaybackMode { try { return localStorage.getItem(PLAYBACK_MODE_KEY) === 'smooth' ? 'smooth' : 'quality'; } catch { return 'quality'; } }
export function bufferTarget(bytesPerSecond: number, mobile = false) { const seconds = Number.isFinite(bytesPerSecond) && bytesPerSecond > 0 ? (mobile ? 48 : 96) * 1024 ** 2 / bytesPerSecond : mobile ? 35 : 60; return Math.round(Math.max(15, Math.min(mobile ? 45 : 90, seconds))); }
export function stableHlsConfig(): Partial<HlsConfig> { return { enableWorker: true, lowLatencyMode: false, maxBufferLength: 45, maxMaxBufferLength: 90, maxBufferSize: 96 * 1024 ** 2, backBufferLength: 15, maxBufferHole: 0.3, highBufferWatchdogPeriod: 2, nudgeOffset: 0.1, nudgeMaxRetry: 4, startFragPrefetch: true, capLevelOnFPSDrop: playbackMode() === 'smooth' }; }
export function bufferedAhead(video: Pick<HTMLVideoElement, 'buffered' | 'currentTime'>) { for (let i = 0; i < video.buffered.length; i++) if (video.buffered.start(i) <= video.currentTime + .15 && video.buffered.end(i) > video.currentTime) return Math.max(0, video.buffered.end(i) - video.currentTime); return 0; }
export function playbackDiagnosis(ahead: number, droppedRatio: number, stalled: boolean) { if (droppedRatio > .05 && ahead > 5) return '缓冲充足但丢帧较多，可能是解码或渲染压力'; if (stalled && ahead < 1) return '可播放缓冲不足，正在等待视频分片'; if (stalled && ahead > 5) return '缓冲已到达，正在等待解码或时间轴恢复'; return '播放状态正常'; }
