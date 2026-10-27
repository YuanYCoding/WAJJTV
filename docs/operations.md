# JjBiTV 运维与回滚

## 当前部署

- 基线：LibreTV 2.16.12，原容器 `libretv`，`127.0.0.1:18080`。
- 当前新版：目录验证、准备状态流与原画备选 `2.19.7-jjbitv.9`，镜像 `jjbitv:v9-20261027`，容器 `jjbitv-v9`，`127.0.0.1:18092`。
- 本次回滚目标：JjBiTV v8，镜像 `jjbitv:v8-20261026`，容器 `jjbitv-v8`，`127.0.0.1:18091`。更早 v7 / v6 / v5 / v4、WAJJTV v3 / v2 继续保留。
- 更早 WAJJTV v1：容器 `wajjtv`，`127.0.0.1:18081`，继续保留。
- 域名：`https://zhuiju.zhaxueit.cn/`，由 Nginx 转发；保留流式响应的 `proxy_buffering off`。
- 新配置：`/opt/jjbitv-v9-20261027/.env`。沿用访问密码、`SITE_ORIGIN`、独立的 `CLOUD_ENCRYPTION_KEY` 以及 `PAN_AUTO_CLEANUP=1`、`PAN_DIRECT_MEDIA=1`，不要提交私密配置到仓库。
- 私人插画：`/opt/wajjtv-v2/private/mascots.png`，只读挂载到 `/app/private`，需登录访问 `/api/couple-art`。
- 健康状态、旧片单数据库与夸克加密凭证：`/opt/jjbitv-20261024/data` 挂载到 `/app/data`，容器用户 UID/GID 1001 需要写权限。
- 历史记录与偏好沿用原 IndexedDB / localStorage 名称，保留原有用户数据兼容性。

## 回滚

在服务器执行：

```sh
sh /opt/jjbitv-v9-20261027/rollback.sh
```

该脚本启动保留的 JjBiTV v8 容器，确认就绪后恢复 Nginx 至 18091，并停止 v9。现有数据目录、两种网盘凭证与清理授权保留。回滚应用不能恢复此前已经永久清理的云端文件；外部地址和准备状态包含内存票据，切换或重启后需要重新准备。

本次备份：`/opt/backups/jjbitv-v8-before-discovery-20261027-095555`，含运行镜像、源码、配置、SQLite 一致性快照、数据和素材。SHA256 与数据库完整性检查已通过；切换前另存 `precutover-*.sqlite`、两个网盘凭证与清理授权快照。原 v7 备份 `/opt/backups/jjbitv-v7-before-playback-20261026-193153`、v6 备份 `/opt/backups/jjbitv-v6-before-pan-expansion-20261026-163025`、v5 / v4 备份继续保留。

预发布在 18092 使用独立 `preview-data`；正式运行挂载既有 `/opt/jjbitv-20261024/data`。切换时只合并同一连接经过验证的较新凭证字段，保留生产转存映射、任务与原有清理授权，不整体覆盖账号。网盘凭证分别位于 `quark-credentials.enc`、`alipan-credentials.enc`，清理授权和播放租约分别为 `netdisk-cleanup-policy.json`、`netdisk-leases.json`，需连同 `.env` 中 `CLOUD_ENCRYPTION_KEY` 备份，不能只复制数据库。日志只输出接口路径、HTTP 状态和业务码，不输出 Cookie、文件凭证或签名地址。

保留的旧备份：`/opt/backups/wajjtv-v2-before-sources-20261023-191103`、`/opt/backups/wajjtv-v1-before-v2-20261021-194353`、`/opt/backups/wajjtv-before-20261021-171816`。备份含私密配置，不上传公共仓库。

## 源健康规则

| 情况 | 行为 |
| --- | --- |
| 一次失败 | 标记待复检，容忍短暂波动 |
| 连续两次失败 | 标记暂时失效，搜索跳过 |
| 暂时失效 | 依次等待 5、15、30、60 分钟复检，之后保持每 60 分钟复检 |
| 复检成功 | 清零失败次数，恢复参与搜索 |
| 冷却时间到期 | 仅允许复检，不直接加入用户搜索 |
| 正常源 | 每 15 分钟复检 |
| 自定义源 | 页面打开且可见时执行复检；部署者预置源由服务器持续复检 |

后台每分钟扫描到期任务，并发上限 3；正常时间和失败回退以最近一次请求结果为基准。搜索与测试共用服务器状态，磁盘保存后可跨重启恢复。接口正常仅说明目录/搜索 API 正常，不保证每部影片都可播放或达到某个清晰度。分片与画质是部署时抽检，播放仍受视频 CDN、网络和具体片源影响。

## 搜索与片库

- 旧版已使用并发流式搜索；新版保留 NDJSON，增加服务器熔断、明确的恢复探测、备用接口去重、请求取消和更短的总超时。
- 默认 `SEARCH_SOURCE_TIMEOUT_MS=6000`，每源默认抓取前 `SEARCH_MAX_PAGES=2` 页。广泛关键词可能不返回某源后续所有页，可提高页数但会增加等待；建议优先搜索完整片名。
- 同一家来源的已知备用域名合并请求，减少重复；健康备用地址不会被失效的主地址挡住。
- 搜索服务缓存 60 秒，浏览器缓存 5 分钟；缓存键包含本地源标识，避免历史记录映射到错误来源。
- 360 影视提供分电影/剧集/动漫/综艺的目录和服务端筛选，支持分页；榜单经 60s API 获取；新番放送来自 Bangumi。
- 片单数量、年份、评分来自提供方；目录中出现影片不代表已找到播放线路。影片与榜单接口暂不可用时显示错误和重试入口。

## 修改与构建

```sh
npm ci
npm run typecheck
npm run lint
npm test
npm run build
```

标准 Dockerfile 可用于独立重建。当前 2GB 服务器采用隔离构建容器、单构建 worker、限制内存与 CPU。V2 发布先绑定 `127.0.0.1:18082` 验证，再切换 Nginx；不要同时给两个容器绑定同一端口。运行环境和 SQLite 说明见 [双人片单文档](shared-library.md)。

私密文件从 `.gitignore` 和 `.dockerignore` 排除；公开源码保留 LibreTV 署名与 AGPL-3.0 许可证。

## V9 验收

53 个测试文件、596 项测试通过，TypeScript、ESLint 与 Linux Node 22 生产构建通过。低配 Linux 构建使用单 worker，测试单项超时预算 20 秒，应用接口本身的超时保持独立。目录验证真实搜索、两种网盘准备弹窗、其他资源实际播放、标签零重搜、返回恢复结果/筛选/位置，以及手机布局均有浏览器验收。未为本轮验收删除原有影片或新增大文件转存。参见 [V9 功能、证据与边界](netdisk-v9.md)。
