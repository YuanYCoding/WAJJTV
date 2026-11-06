import { AbstractTokenizer, EndOfStreamError, type IReadChunkOptions } from 'strtok3/core';
/** Random access for metadata only. Never download an entire song to find its duration. */
export class MusicRangeTokenizer extends AbstractTokenizer {
  readonly fileInfo: { size: number; mimeType?: string };
  private pages = new Map<number, Uint8Array>();
  private requests = 0;
  constructor(size: number, initial: Uint8Array, private load: (start: number, end: number) => Promise<Uint8Array>, mimeType?: string, private randomAccess = true) {
    super({ maxBufferSize: 524288 }); this.fileInfo = { size, mimeType }; this.pages.set(0, initial);
  }
  supportsRandomAccess() { return this.randomAccess; }
  setPosition(position: number) { this.validateLength(position, 'position'); this.position = position; }
  async peekBuffer(buffer: Uint8Array, options?: IReadChunkOptions) {
    const o = this.normalizeOptions(buffer, options), wanted = Math.min(o.length, Math.max(0, this.fileInfo.size - o.position));
    if (wanted < o.length && !o.mayBeLess) throw new EndOfStreamError();
    let read = 0;
    while (read < wanted) {
      const position = o.position + read, start = Math.floor(position / 131072) * 131072;
      let page = this.pages.get(start);
      if (!page) {
        if (++this.requests > 5) throw new Error('音频元数据读取超出限额');
        page = await this.load(start, Math.min(start + 131071, this.fileInfo.size - 1));
        if (this.pages.size >= 4) this.pages.delete(this.pages.keys().next().value!);
        this.pages.set(start, page);
      }
      const offset = position - start, n = Math.min(wanted - read, page.length - offset);
      if (n <= 0) throw new EndOfStreamError();
      buffer.set(page.subarray(offset, offset + n), read); read += n;
    }
    return read;
  }
  async readBuffer(buffer: Uint8Array, options?: IReadChunkOptions) {
    const position = options?.position ?? this.position, read = await this.peekBuffer(buffer, options); this.position = position + read; return read;
  }
}
