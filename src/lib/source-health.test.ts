import { describe, expect, it } from 'vitest';
import { nextHealth, sourceIdentity, HEALTHY_INTERVAL, RECOVERY_DELAYS } from './source-health';
describe('source recovery policy', () => {
  it('tolerates one failure; second failure opens the circuit for a probe in 5 minutes', () => {
    const one = nextHealth(undefined, false, 6000, 'timeout', 100);
    expect(one.status).toBe('suspect');
    const two = nextHealth(one, false, 6000, 'timeout', 200);
    expect(two.status).toBe('unavailable');
    expect(two.nextCheckAt).toBe(200 + 300_000);
  });
  it('caps recovery at one hour indefinitely, and only success closes the circuit', () => {
    let h = nextHealth(nextHealth(undefined, false), false);
    for (let i = 0; i < 10; i++) h = nextHealth(h, false, 5000, 'timeout', i * 9999999);
    expect(h.status).toBe('unavailable');
    expect(h.nextCheckAt - h.checkedAt).toBe(RECOVERY_DELAYS[3]);
    const recovered = nextHealth(h, true, 200, undefined, 500);
    expect(recovered).toMatchObject({ status: 'healthy', failures: 0, recoveryLevel: 0, nextCheckAt: 500 + HEALTHY_INTERVAL });
  });
  it('keeps independent mirror endpoints searchable and only removes exact URL duplicates', () => {
    expect(sourceIdentity('https://api.ffzyapi.com/api.php/provide/vod')).not.toBe(sourceIdentity('http://cj.ffzyapi.com/api.php/provide/vod'));
    expect(sourceIdentity('https://www.huyaapi.com/api.php/provide/vod/from/hym3u8')).not.toBe(sourceIdentity('https://www.huyaapi.com/api.php/provide/vod'));
    expect(sourceIdentity('https://cms.example/api/')).toBe(sourceIdentity('https://cms.example/api'));
    expect(sourceIdentity('https://cms.example/api')).not.toBe(sourceIdentity('http://cms.example/api'));
    expect(sourceIdentity('https://my.example/a')).not.toBe(sourceIdentity('https://my.example/b'));
  });
});
