export interface PanSource { id: string; name: string; status?: 'ready' | 'cooldown'; nextCheck?: number }
export interface PanResult {
  id: string; title: string; source: string; sourceName: string; shareUrl: string; passcode: string;
  qualityHint: string; checked?: boolean;
}
export interface PanFile {
  key: string; identity: string; name: string; folder: boolean; size: number; parentKey?: string;
  width?: number; height?: number;
}
export interface PanListing { title: string; items: PanFile[]; total: number; hasMore: boolean; page: number; shareUrl: string }
export interface PanQuality { label: string; url: string; kind: 'hls' | 'video'; width?: number; height?: number }
export interface PanStatus { configured: boolean; connected: boolean; name?: string; sources: PanSource[] }
export type PanSearchEvent = { type: 'results'; source: string; list: PanResult[]; ms: number; error?: string }
  | { type: 'done'; count: number; failures: number };
