export type ResourceKind = 'hls' | 'pan';
export interface ResourceSource { id: string; name: string; url: string; kind: ResourceKind; adapter: string; enabled: boolean; builtin?: boolean; priority?: number }
export interface ResourceSourceConfig { revision: number; sources: ResourceSource[] }
export interface ResourceSourceHealth { failures: number; nextCheck: number; checkedAt: number; ms?: number; error?: string; sample?: { width?: number; height?: number; evidence?: string } }
