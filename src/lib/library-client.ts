'use client';
import { ApiError } from './client-api';
import type { FilmInput, LibraryItem, LibraryResponse, Preference, ProfileId, TonightRound } from './library-types';

export class LibraryClientError extends ApiError {
  constructor(message: string, status: number, public code?: string, public details?: LibraryItem[]) { super(message, status); }
}
async function request<T>(url: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { method, signal, headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new LibraryClientError('网络连接失败，改动尚未保存，请重试', 0);
  }
  let data;
  try { data = await res.json(); }
  catch { throw new LibraryClientError('片单服务响应异常，请刷新后重试', res.status); }
  if (res.status === 401) window.dispatchEvent(new CustomEvent('libretv:unauthorized'));
  if (!res.ok) throw new LibraryClientError(data.error || '请求失败', res.status, data.code, data.details);
  return data as T;
}
export const libraryApi = {
  profile: (signal?: AbortSignal) => request<{ profile: ProfileId | null }>('/api/profile', 'GET', undefined, signal),
  selectProfile: (profile: ProfileId) => request<{ profile: ProfileId }>('/api/profile', 'PUT', { profile }),
  list: (signal?: AbortSignal) => request<LibraryResponse>('/api/library', 'GET', undefined, signal),
  resolve: (film: FilmInput, decision?: 'separate' | 'link', existingId?: string) => request<{ item: LibraryItem }>('/api/films/resolve', 'POST', { film, decision, existingId }),
  preference: (filmId: string, status: Preference, expectedRevision: number, profile: ProfileId) => request<{ item: LibraryItem }>('/api/preferences', 'PUT', { filmId, status, expectedRevision, profile }),
  tonight: (signal?: AbortSignal) => request<TonightRound>('/api/tonight', 'GET', undefined, signal),
  draw: (expectedVersion: number, reset: boolean) => request<TonightRound>('/api/tonight', 'POST', { expectedVersion, reset }),
  curated: (signal?: AbortSignal) => request<{ items: (FilmInput & { classification?: LibraryItem['film']['classification'] })[] }>('/api/curated', 'GET', undefined, signal),
};

/** Poll only visible views; focus refresh and cache invalidation handle foreground navigation. */
export const SHARED_QUERY_OPTIONS = { staleTime: 0, refetchInterval: 15_000, refetchIntervalInBackground: false, refetchOnWindowFocus: true, retry: 1 } as const;
export const LIBRARY_KEY = ['shared-library'] as const;
export const TONIGHT_KEY = ['shared-tonight'] as const;
export const PROFILE_KEY = ['active-profile'] as const;
