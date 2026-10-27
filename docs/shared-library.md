# 双人片单与今晚选片

## 使用方式

登录后选择海清或静静。顶部可以切换档案；两个人可以互相查看片单，档案不代表独立的隐私权限。

点开首页或榜单的海报查看影片资料，可标记想看、看过、不感兴趣。三种状态对每个人分别保存，再次点击当前状态可取消。影片没有可用播放源或缺少简介时仍可收藏；播放历史不会自动改变“看过”状态。

“我们的片单”按全部想看、都想看、海清想看、静静想看、当前档案看过、不感兴趣筛选。可见页面每 15 秒同步，窗口重新聚焦时刷新；保存失败会回退按钮状态并明确提示。

“今晚看什么”按北京时间每天共享一组最多三部的候选。先抽双方都想看的，再补一方想看、另一方未表态的；任一方看过、不感兴趣或属于独立分类的条目被排除。换一批不会改偏好，当天不重复抽取已展示条目；耗尽后需明确点击“重新抽一轮”。候选不足时不从全站补齐。

## 影片身份与接口

- 影片使用 UUID；`aliases` 保存提供方、稳定来源 ID、影片类型到 UUID 的映射。
- 同一来源 ID 重复收藏只保留一条。跨来源出现同名、类型相同且年份相容的影片时，前端要求明确关联或分开保存；不同已知年份不自动合并。
- 百度榜单优先使用百科 URL 的持久 ID，缺失时才使用规范化片名，绝不以排名序号作为身份。
- `GET/PUT /api/profile`：读取、切换当前浏览器档案；cookie 为 HttpOnly，遵循原有 HTTPS 配置。
- `GET /api/library`：共享片单与两个人的状态、版本号。
- `POST /api/films/resolve`：解析稳定影片身份；疑似重复返回 `MATCH_CONFIRMATION` 和候选。
- `PUT /api/preferences`：修改当前档案的状态，携带档案和旧版本号；档案切换竞态或过期修改返回 409，重复的同状态请求幂等。
- `GET/POST /api/tonight`：读取或重抽当天候选；事务内检查候选版本，避免两个人同时换一批覆盖彼此。
- `GET /api/curated`：读取带来源依据的独立精选分类。

所有接口要求登录。写接口要求 JSON 和与 `SITE_ORIGIN` 匹配的 Origin。影片 metadata 写入限制字段与长度，分类标签由服务端核实目录推导，不能通过客户端自报 III 级。

## 持久化与运行环境

使用 Node 内置 `node:sqlite`，数据文件为 `${LIBRARY_DATA_DIR}/library.sqlite`；未配置时复用 `HEALTH_DATA_DIR`，最后回退项目 `data` 目录。数据库保存影片快照、来源映射、偏好和当天候选，使用 WAL、外键和短事务。旧 IndexedDB 与 localStorage 保持兼容，跨设备播放进度不在本次范围。

当前服务器版本采用 Debian Bookworm 的官方 Node 22 镜像，默认 Docker 隔离策略不变。实测旧 CentOS 7 内核与原 Alpine/musl 运行库组合会令 SQLite 写入的 `pwritev2(..., RWF_NOAPPEND)` 返回 EPERM，表现为 SQLITE_IOERR_WRITE（778）。因此 Dockerfile 使用 `node:22-bookworm-slim`，不通过关闭数据库同步或取消容器隔离来回避问题。

数据库目录需对容器用户 UID/GID 1001 可写；私有图片目录只读挂载。标准 Compose 使用持久卷保存数据库。部署时必须填写用户访问的真实 `SITE_ORIGIN`。

## 独立分类依据

分类收录普通剧情长片，题材和年龄分级分开标注，保存核实日期及依据链接。首批为四部已核实资料的影片；这不是完整分级数据库。

- 剧情向伦理精选：《步履不停》依据 [Criterion 发行资料](https://www.criterion.com/films/27540-still-walking)；《一次别离》依据 [Sony Pictures Classics 剧情资料](https://www.sonyclassics.com/aseparation/synopsis.html)。这两项是编辑题材归类，不是 III 级标识。
- 香港 III 级：《暴力史／暴力效应》和《剧场前／站在剧院前》依据香港国际电影节 2026 年的 [影片资料一](https://cinefan.hkiff.org.hk/zh/movie/a-history-of-violence-26)、[影片资料二](https://cinefan.hkiff.org.hk/zh/movie/tale-of-cinema-26)。分级指对应资料所列放映版本。
- 已核实条目从普通片库推荐与今晚候选中排除；明确关联到精选条目的跨来源别名同样继承分类，避免原始年份缺失时漏掉隔离。

## 发布与恢复

升级前的 WAJJTV v1 备份：`/opt/backups/wajjtv-v1-before-v2-20261021-194353`。包含镜像、配置、私人素材、健康状态、TLS、Nginx 和源代码归档，已校验 SHA-256 并重新加载镜像。

V2 使用 `/opt/wajjtv-v2` 的部署目录，应用内仍挂载 `/app/data` 与 `/app/private`；主机目录独立，保留原 v1 用户权限和回滚数据。预览端口为 `127.0.0.1:18082`，验收后再切换 Nginx。

运行中的 SQLite 应使用 SQLite 的备份接口获取一致快照，不应单独复制 `.sqlite` 而忽略 WAL。恢复时先停止写入，保留现有数据库，再使用经过校验的快照。
