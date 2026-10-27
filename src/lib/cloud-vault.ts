import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

export interface CloudCredentials {
  id: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  name: string;
  drives: { id: string; name: string }[];
}

/** Credentials never enter SQLite exports, localStorage, API responses or application logs. */
export class CloudVault<T extends { id: string } = CloudCredentials> {
  constructor(private directory: string, private secret: string, private filename: 'cloud-credentials.enc' | 'quark-credentials.enc' | 'alipan-credentials.enc' = 'cloud-credentials.enc') {}
  private key() {
    const key = Buffer.from(this.secret, 'hex');
    if (key.length !== 32 || !/^[a-f\d]{64}$/i.test(this.secret)) throw new Error('Cloud encryption key is not configured');
    return key;
  }
  get configured() { return /^[a-f\d]{64}$/i.test(this.secret); }
  private get path() { return join(this.directory, this.filename); }
  read(): T | null {
    let file: string;
    try { file = readFileSync(this.path, 'utf8'); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e; }
    const data = JSON.parse(file);
    const decipher = createDecipheriv('aes-256-gcm', this.key(), Buffer.from(data.iv, 'hex'));
    decipher.setAuthTag(Buffer.from(data.tag, 'hex'));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(data.ciphertext, 'base64')), decipher.final()]).toString('utf8'));
  }
  write(credentials: T, expectedId?: string): boolean {
    if (expectedId && this.read()?.id !== expectedId) return false;
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key(), iv);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(credentials), 'utf8'), cipher.final()]);
    const tmp = this.path + '.tmp';
    writeFileSync(tmp, JSON.stringify({ iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), ciphertext: ciphertext.toString('base64') }), { mode: 0o600 });
    renameSync(tmp, this.path);
    return true;
  }
  clear() { try { unlinkSync(this.path); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; } }
}

export function cloudVault() {
  return new CloudVault(process.env.LIBRARY_DATA_DIR || './data', process.env.CLOUD_ENCRYPTION_KEY || '');
}
