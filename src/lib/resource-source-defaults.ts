import type { ResourceSource } from './resource-source-types';
export const DEFAULT_RESOURCE_SOURCES: ResourceSource[] = [
  ...[
    ['zuid', '最大 HLS · 含实测 4K', 'https://api.zuidapi.com/api.php/provide/vod/'],
    ['mangguo', '芒果 HLS', 'https://caiji.mgzyapi.com/api.php/provide/vod/'],
    ['guangsu', '光速 HLS', 'https://api.guangsuapi.com/api.php/provide/vod/'],
    ['baofeng', '暴风 HLS', 'https://bfzyapi.com/api.php/provide/vod/'],
    ['haohua', '豪华 HLS', 'https://hhzyapi.com/api.php/provide/vod/'],
    ['huya', '虎牙 HLS', 'https://www.huyaapi.com/api.php/provide/vod/'],
    ['jinying', '金鹰 HLS', 'https://jyzyapi.com/provide/vod/'],
    ['jisu', '极速 HLS', 'https://jszyapi.com/api.php/provide/vod/'],
    ['hongniu', '红牛 HLS', 'https://www.hongniuzy2.com/api.php/provide/vod/'],
    ['iqiyi', '爱奇艺资源站 HLS', 'https://iqiyizyapi.com/api.php/provide/vod/'],
    ['modu', '魔都 HLS', 'https://www.mdzyapi.com/api.php/provide/vod/'],
    ['feifan', '非凡 HLS', 'https://api.ffzyapi.com/api.php/provide/vod/'],
    ['dytt', '电影天堂 HLS', 'http://caiji.dyttzyapi.com/api.php/provide/vod/'],
    ['subo', '速播 HLS', 'https://subocaiji.com/api.php/provide/vod/'],
    ['baidu', '百度云资源 HLS', 'https://api.apibdzy.com/api.php/provide/vod/'],
    ['uku', 'U酷 HLS', 'https://api.ukuapi88.com/api.php/provide/vod/'],
    ['hongniu-backup', '红牛备用 HLS', 'https://www.hongniuzy3.com/api.php/provide/vod/'],
    ['modu-backup', '魔都备用 HLS', 'https://caiji.moduapi.cc/api.php/provide/vod/'],
    ['feifan-backup', '非凡备用 HLS', 'https://cj.ffzyapi.com/api.php/provide/vod/'],
    ['jinying-backup', '金鹰备用 HLS', 'https://jinyingzy.com/api.php/provide/vod/'],
    ['zuid-backup', '最大备用 HLS', 'https://zuidazy.me/api.php/provide/vod/'],
  ].map(([id, name, url], i) => ({ id: 'hls-' + id, name, url, kind: 'hls' as const, adapter: 'cms', enabled: !id.endsWith('-backup'), builtin: true, priority: i })),
  ...[
    ['yunso', '小云搜索', 'https://www.yunso.net'], ['melost', '影盘社', 'https://www.melost.cn'], ['erxiao', '花卷影视', 'https://www.2xiaopan.one'], ['dyyj', '电影云集', 'https://bbs.dyyjmax.org'], ['wanou', '玩偶片库', 'https://woog.nxog.eu.org'], ['aipan', '爱盼影视', 'https://www.aipan.me'], ['pan365', '365 聚合', 'https://pan.365wp.top'], ['muou', '木偶网盘', 'https://www.muoua.top'], ['quarktv', '夸克影视', 'https://www.quarktv.com'], ['quark4k', '夸克 4K 社区', 'https://quark4k.com'],
  ].map(([id, name, url]) => ({ id, name, url, kind: 'pan' as const, adapter: id, enabled: true, builtin: true })),
];
