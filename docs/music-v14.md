# Platform music tabs (v14)

Release: `2.19.7-jjbitv.14`, 2026-11-06. Production: https://zhuiju.zhaxueit.cn/music.

The latest UI request supersedes v13's unified search view. Tabs now appear in this order: QQ音乐, 网易云, 酷我, 酷狗, Audius. QQ is the default when enabled. Disabled sources are omitted; if QQ is disabled, the first enabled source becomes the default. There is no “全部” tab. Favorites remain a separate toggle.

Only the selected platform is queried. The `source` URL parameter preserves platform selection during search, pagination, browser back and refresh. Completed results are cached by query, page and platform for five minutes within the current browser session. Returning to a fresh cache does not send another search request. Expired playback receipts are still refreshed when playing a song. Favorites do not trigger background catalog searches.

Incremental results are tagged with their query/platform/page identity. A canceled platform's late response cannot populate another tab. Requests use React Query's cancellation signal. Existing full-audio verification, source adapters, quality selection and global player remain in place.

Verification: Linux type checking, lint, 643 tests in 66 files and production build passed. Rendered browser checks cover default QQ, exact tab order, no All, selected-platform-only real search, cached switching without duplicate requests, canceled-request isolation, pagination, browser back, reload, new queries, keyboard navigation and 390px mobile layout. Actual “晴天” playback decoded 269.7467 seconds; seeking and a quality change retained playback position. The first verified result took 4193ms including page navigation in this sample. Cached tab return took 129ms in the controlled UI test; this is not a live upstream performance guarantee.

Deployment: `jjbitv-v14`, `127.0.0.1:18097`, behind existing Nginx. Current v13 image, configuration and consistent SQLite snapshots were saved under `/opt/backups/jjbitv-v13-before-platform-tabs-20261106`; SQLite integrity checks passed. Rollback: `/opt/jjbitv-v14-20261106/rollback.sh`. Existing persistent data directory is unchanged. No schema migration is included.

Production smoke checks confirmed v14 is live and healthy, 41 VOD interfaces, six live subscriptions, 21 HLS sources and ten cloud sources remain configured, both cloud accounts remain connected, and the main video/cloud/live pages render without JavaScript errors.
