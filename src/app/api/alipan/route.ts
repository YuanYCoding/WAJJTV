import { NextResponse } from 'next/server';
import { libraryGuard } from '@/lib/library-api-server';
import { panBody, panFailure } from '@/lib/netdisk-http';
import { PanError } from '@/lib/netdisk-utils';
import { aliStatus, startAliLogin, pollAliLogin, disconnectAli, listAliFiles, playAliFile, setAliCleanup } from '@/lib/alipan-server';
import { touchPlaybackLease } from '@/lib/netdisk-storage';
export const runtime = 'nodejs';
export async function GET(req: Request) { const guard = libraryGuard(req); if (guard) return guard; try { return NextResponse.json(aliStatus(), { headers: { 'Cache-Control': 'no-store' } }); } catch (e) { return panFailure(e); } }
export async function POST(req: Request) {
  const guard = libraryGuard(req, true); if (guard) return guard;
  try { const body = await panBody(req); const str = (key: string) => typeof body[key] === 'string' ? body[key] as string : ''; let value: unknown;
    switch (body.action) {
      case 'login': value = await startAliLogin(req); break;
      case 'poll': value = await pollAliLogin(req, str('id')); break;
      case 'disconnect': value = disconnectAli(); break;
      case 'cleanupPreference': if (typeof body.enabled !== 'boolean') throw new PanError('清理设置无效'); value = setAliCleanup(body.enabled); break;
      case 'list': value = await listAliFiles(req, str('shareUrl'), str('passcode'), str('parentKey'), str('marker')); break;
      case 'preview': value = await playAliFile(req, str('key')); break;
      case 'play': if (body.saveConsent !== true) throw new PanError('请确认仅转存选中的视频', 409); if (str('replaceLease')) touchPlaybackLease(req, str('replaceLease'), true); value = await playAliFile(req, str('key'), true); break;
      default: throw new PanError('未知的阿里云盘操作');
    }
    return NextResponse.json(value, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) { return panFailure(e); }
}
