export type PanProvider = 'quark' | 'aliyun';
export interface PanSource { id: string; name: string; status?: 'ready' | 'cooldown'; nextCheck?: number; providers?: PanProvider[] }
export interface PanResult {
  id: string; title: string; source: string; sourceName: string; shareUrl: string; passcode: string;
  qualityHint: string; checked?: boolean; provider?: PanProvider;
}
export interface PanFile {
  key: string; identity: string; name: string; folder: boolean; size: number; parentKey?: string;
  width?: number; height?: number;
}
export interface PanListing { title: string; items: PanFile[]; total: number; hasMore: boolean; page: number; shareUrl: string; marker?: string }
export interface PanQuality { label: string; url: string; kind: 'hls' | 'video'; width?: number; height?: number; limited?: boolean; duration?: number }
export interface PanPlayback { qualities: PanQuality[]; saved: boolean; duration?: number; sourceDuration?: number; limited?: boolean; original?: { width?: number; height?: number; size?: number }; unavailable?: string[]; notice?: string; lease?: string; cleaned?: number }
export interface PanStatus { configured: boolean; connected: boolean; name?: string; sources: PanSource[] }
export type PanSearchEvent = { type: 'results'; source: string; list: PanResult[]; ms: number; error?: string }
  | { type: 'done'; count: number; failures: number };
