# WAJJTV

海清和静静自用追剧资源。基于 [LibreTV](https://github.com/LibreSpark/LibreTV) 的私人影院版本。

- 深色暖金界面、专属双人角色、电脑与手机适配。
- 电影、剧集、动漫、综艺片库，类型/地区/年代筛选、评分与热度排序、分页加载。
- 豆瓣/百度榜单与 Bangumi 本周放送。
- 多源并发流式搜索、备用接口去重；失效源暂时隔离，后台复检成功后恢复。
- 沿用 LibreTV 播放器、观看历史、收藏、直播与配置格式。

## 本地运行

```sh
npm ci
# 在 .env.local 中配置 PASSWORD 与 DEFAULT_SOURCES
npm run dev
```

私人角色可放到 `private/mascots.png`。该目录不入库、不进入镜像；图片接口要求登录。缺少图片时显示 W & J 字样。应用沿用原有 LibreTV 数据存储键，升级不会主动删除观看历史。

```sh
npm run typecheck
npm run lint
npm test
npm run build
```

## 部署说明

[当前部署、探测频率与回滚](docs/operations.md) · [源实测记录](docs/source-audit.json) · [新增来源订阅](docs/verified-additions.json) · [设计约定](docs/design.md)

完整的播放器、直播、订阅和环境变量说明见 [上游文档](https://github.com/LibreSpark/LibreTV#readme)。片单数据与播放线路来自不同提供方，能发现影片并不保证有可用播放线路；源的可用性和清晰度随具体影片及网络变化。

## 开源许可

保留 LibreSpark/LibreTV 的原始署名与 [AGPL-3.0 许可证](LICENSE)。WAJJTV 的应用修改开放源码；部署密码和私人角色不包含在源码中。
