import { parseFromTokenizer } from 'music-metadata';
import { fetchUpstream, fetchUpstreamWithMeta } from './fetch-utils';
import type { MusicQuality } from './music-types';
import { MusicRangeTokenizer } from './music-range-tokenizer';

export interface MusicAudioInfo { duration: number; codec: string; kbps: number; sampleRate: number; bits: number; lossless: boolean; size: number; finalUrl?: string; mimeType?: string }
export function validateFullMusic(info: MusicAudioInfo, expected: number, quality: MusicQuality) {
  if (!Number.isFinite(expected) || expected <= 0) throw new Error('无法确认完整时长');
  if (!Number.isFinite(info.duration) || info.duration < expected * .92 || Math.abs(info.duration - expected) > Math.max(12, expected * .08)) throw new Error('音频时长不符，可能是试听片段');
  if (!info.sampleRate || !/MPEG.*Layer.*3|MP3|FLAC|AAC|Vorbis|Opus|PCM/i.test(info.codec)) throw new Error('浏览器暂不支持此音频格式');
  if ((quality === 'flac' || quality === 'flac24bit') && !info.lossless) throw new Error('来源未提供无损音频');
  if (quality === 'flac24bit' && info.bits < 24) throw new Error('来源未提供24bit音频');
  if (quality === '320k' && (info.lossless || info.kbps < (/AAC|Opus|Vorbis/i.test(info.codec) ? 175 : 270))) throw new Error('来源未提供高品质音频');
  if (quality === '128k' && (info.lossless || info.kbps < (/AAC/i.test(info.codec) ? 80 : 100) || info.kbps > 180)) throw new Error('来源未提供标准音质');
  return info;
}
export async function probeMusicAudio(url: string, signal: AbortSignal): Promise<MusicAudioInfo> {
  const u = new URL(url);
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) throw new Error('无效音频地址');
  const { res: r, finalUrl } = await fetchUpstreamWithMeta(url, { signal, timeoutMs: 6500, headers: { Range: 'bytes=0-131071', 'User-Agent': 'Mozilla/5.0' } });
  if (!r.ok || !r.body) { await r.body?.cancel(); throw new Error('音频未响应'); }
  const reader = r.body.getReader(), parts: Uint8Array[] = []; let length = 0;
  try {
    if (!/audio|octet-stream|video\/mp4/i.test(r.headers.get('content-type') || '')) throw new Error('返回内容不是音频');
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      const chunk = value.subarray(0, 131072 - length); parts.push(chunk); length += chunk.length;
      if (length >= 131072) break;
    }
  } finally { await reader.cancel().catch(() => {}); }
  const size = Number(r.headers.get('content-range')?.split('/')[1] || r.headers.get('content-length'));
  if (!Number.isFinite(size) || size < 1024 || size > 2_000_000_000) throw new Error('无法确认音频大小');
  const buffer = Buffer.concat(parts);
  const magic = buffer.subarray(0, 4).toString('ascii');
  const mimeType = magic === 'fLaC' ? 'audio/flac' : magic === 'OggS' ? 'audio/ogg' : magic === 'RIFF' ? 'audio/wav' : buffer.subarray(4, 8).toString() === 'ftyp' ? 'audio/mp4' : magic.startsWith('ID3') ? 'audio/mpeg' : undefined;
  const tokenizer = new MusicRangeTokenizer(size, buffer, async (start, end) => {
    const part = await fetchUpstream(finalUrl, { signal, timeoutMs: 5000, headers: { Range: `bytes=${start}-${end}`, 'User-Agent': 'Mozilla/5.0' } });
    if (part.status !== 206 || !part.body || !part.headers.get('content-range')?.startsWith(`bytes ${start}-`)) { await part.body?.cancel(); throw new Error('来源不支持按位置读取'); }
    const reader = part.body.getReader(), chunks: Uint8Array[] = []; let length = 0;
    try { for (;;) { const { done, value } = await reader.read(); if (done) break; const v = value.subarray(0, end - start + 1 - length); chunks.push(v); length += v.length; if (length >= end - start + 1) break; } }
    finally { await reader.cancel().catch(() => {}); }
    return Buffer.concat(chunks);
  }, mimeType, mimeType === 'audio/mp4');
  const metadata = await parseFromTokenizer(tokenizer, { skipCovers: true, skipPostHeaders: true, duration: false, maxMemoryAllocation: 524288, maxMetadataEntries: 200 });
  await tokenizer.close();
  if (/试听|播放失败|获取失败|error/i.test(metadata.common.title || '')) throw new Error('来源返回错误音频');
  const f = metadata.format;
  return { duration: f.duration || 0, codec: f.codec || '', kbps: Math.round((f.bitrate || 0) / 1000), sampleRate: f.sampleRate || 0, bits: f.bitsPerSample || 0, lossless: f.lossless === true, size, finalUrl,
    mimeType: f.container === 'FLAC' ? 'audio/flac' : f.container === 'MPEG' ? 'audio/mpeg' : /MP4|M4A/i.test(f.container || '') ? 'audio/mp4' : /ADTS/i.test(f.container || '') ? 'audio/aac' : undefined };
}
