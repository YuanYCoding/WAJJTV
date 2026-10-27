import { libraryGuard } from '@/lib/library-api-server';
import { panBody, panFailure } from '@/lib/netdisk-http';
import { prepareJob, prepareStream } from '@/lib/netdisk-prepare';
import { PanError } from '@/lib/netdisk-utils';
export const runtime = 'nodejs';
export async function POST(req: Request) {
  const guard = libraryGuard(req, true); if (guard) return guard;
  try {
    const body = await panBody(req); if (body.saveConsent !== true || !['aliyun', 'quark'].includes(String(body.provider))) throw new PanError('播放准备参数无效');
    const str = (key: string) => typeof body[key] === 'string' ? body[key] as string : '';
    return prepareStream(prepareJob(req, { provider: body.provider as 'aliyun' | 'quark', key: str('key'), replaceLease: str('replaceLease'), operation: str('operation') }), req.signal);
  } catch (e) { return panFailure(e); }
}
