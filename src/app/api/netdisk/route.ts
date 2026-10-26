import { NextResponse } from 'next/server';
import { libraryGuard } from '@/lib/library-api-server';
import { quarkStatus, startQuarkLogin, pollQuarkLogin, disconnectQuark, listQuarkShare, playQuarkFile } from '@/lib/quark-server';
import { panSources } from '@/lib/netdisk-search';
import { PanError } from '@/lib/netdisk-utils';
import { panBody, panFailure } from '@/lib/netdisk-http';
export const runtime = 'nodejs';
export async function GET(req: Request) {
  const guard = libraryGuard(req); if (guard) return guard;
  try { return NextResponse.json({ ...quarkStatus(), sources: panSources() }, { headers: { 'Cache-Control': 'no-store' } }); }
  catch (error) { return panFailure(error); }
}
export async function POST(req: Request) {
  const guard = libraryGuard(req, true); if (guard) return guard;
  try {
    const body = await panBody(req); const text = (key: string) => typeof body[key] === 'string' ? body[key] as string : '';
    let value: unknown;
    switch (body.action) {
      case 'login': value = await startQuarkLogin(req); break;
      case 'poll': value = await pollQuarkLogin(req, text('id')); break;
      case 'disconnect': value = disconnectQuark(); break;
      case 'list': value = await listQuarkShare(req, text('shareUrl'), text('passcode'), text('parentKey'), Number(body.page || 1)); break;
      case 'play':
        if (body.saveConsent !== true) throw new PanError('播放此分享需要确认转存到 JjBiTV 追剧目录', 409);
        value = await playQuarkFile(req, text('key')); break;
      default: throw new PanError('未知的网盘操作');
    }
    return NextResponse.json(value, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return panFailure(error); }
}
