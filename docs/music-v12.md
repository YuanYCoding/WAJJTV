# JjBiTV music and media room

## Scope

Version `2.19.7-jjbitv.12` adds `/music`, authenticated music APIs, an HTMLAudioElement player shared by client-side navigation, per-device favorites/queue/source selection, and a combined cinema/music homepage. Existing cloud credentials, film library, VOD sources, live sources and playback services retain their storage and API contracts.

The design rule applies to the entire app: **Avoid unnecessary secondary labels and descriptions. Let the layout do the explaining.** Necessary state/error messages, preview labels and destructive-operation consequences remain visible. Long reference information belongs in collapsed details.

## Music protocols

`src/lib/music-interfaces.ts` is the public protocol inventory, available to logged-in users through Settings → Sources → Music and `GET /api/music/sources`. Fifteen endpoint templates describe search and playback separately; they do not represent fifteen independent libraries or fifteen guaranteed full-song providers.

- Chinese catalogs: NetEase, QQ, Kuwo and Kugou. NetEase combines native and GD catalogs by stable platform ID. Kuwo uses Muming's enriched first page with the native catalog as fallback/subsequent pages.
- Audio resolution: Huibq, GD (NetEase fallback), Muming (Kuwo fallback), VKeys (QQ fallback) and native NetEase public playback. VKeys previews are labeled; encrypted files with `ekey` are not handled.
- Audius: public, streamable uploads only; gated tracks are filtered.
- Apple: official previews only, never presented as complete songs.

Source references: [LX Music](https://github.com/lyswhut/lx-music-desktop), [Huibq](https://github.com/Huibq/keep-alive), [GD](https://music.gdstudio.xyz), [Muming](https://xiaoapi.cn/detail/7), [VKeys](https://github.com/lvluoyue/api-doc), [Audius](https://docs.audius.co/api), [Apple Search API](https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/iTuneSearchAPI/index.html).

The other supplied source collections were inspected as references: [guoyue2010](https://github.com/guoyue2010/lxmusic-), [wzh15802](https://github.com/wzh15802/lxmusic), [xzh767](https://github.com/xzh767/lxmusic-source-all). Overlapping scripts are not counted as independent providers. Downloaded third-party JavaScript is not executed or imported into the production runtime.

## API and playback behavior

- `GET /api/music/search?q=&page=&sources=` returns NDJSON, one provider result per line. Provider requests are parallel, bounded and cached for 120 seconds. Visible result filtering is local; React Query retains searches for five minutes. Three catalog failures trigger a one-minute cooldown.
- `POST /api/music/play` accepts only a known provider and bounded platform ID. It requires authentication and same-origin JSON. The server resolves then probes the audio. HTML, missing URLs, and tiny error recordings are rejected.
- `GET /api/music/stream?ticket=` requires authentication and an opaque, expiring, server-issued ticket. It forwards a single valid Range request and streams without buffering the whole file. Redirects use existing SSRF checks. Tickets are process-local and invalid after a restart; selecting the song again resolves a new ticket.
- The player supports seeking, volume, sequence/repeat/shuffle, next/previous, queue, local favorites and MediaSession controls. It pauses when a video starts. Playback failures remain visible rather than silently changing to a different recording.
- Favorites and queue are stored in `jjbitv-music-v1` on the current device; they do not synchronize between users/devices. No server database schema change is introduced.

## Verification boundaries

Server probes checked catalog responses, resolved audio MIME type, ID3 headers, byte-range responses and sizes. Browser QA checks decoding/time advancement, seeking, pause/resume, persistent client-navigation playback, favorite actions, no repeated search on source filtering, desktop/mobile overflow, authentication, origin checks, and interface inventory visibility. Unit tests cover catalog parsing without eval, identities, false-success error MP3s, HTML challenges, opaque stream tickets, independent fallback paths and preview labeling.

Candidate sources were excluded when actual audio was not obtained: old Migu web search returned HTML; a newer Migu catalog responded but its tested audio resolved to the same tiny error MP3. GD JOOX/Bilibili returned empty URLs or 503. Openverse/Archive were unreachable from this server. ccMixter catalog worked but tested audio returned 403. A Meting instance returned an empty response. These observations describe samples taken during deployment, not permanent provider-wide judgments.

Upstream availability, rights/region restrictions, complete track coverage and claimed lossless quality cannot be guaranteed by a successful catalog request. Source names and filenames are not proof of actual quality.

## Operations

Pre-upgrade backup: `/opt/backups/jjbitv-v11-before-music-20261106` (image, deployment/Nginx configuration and a transactionally consistent SQLite dump verified with `integrity_check`). Earlier backups remain.

Build/deployment: `/opt/jjbitv-v12-20261106`. Preview binds to `127.0.0.1:18082`, using a separate data copy. At the user's request, **production has not switched** and remains v11 on port 18094. The preview entry `https://zhuiju.zhaxueit.cn/__preview/v12` sets a Secure/HttpOnly/SameSite cookie that routes only that browser to v12. `/__preview/exit` clears the cookie and returns to v11. Both use the site's existing password. Nginx before preview routing is preserved as `nginx-before-preview.conf`. Promotion requires the user's follow-up after trying the preview.

Hero asset: `public/art/listening-room-v12.webp`, generated using the built-in image tool. Prompt: a wide private cinema/listening room at night, charcoal interior, champagne lamps, turntable and mountain screen on the right, quiet dark space for native typography on the left, no people, labels or logo. Existing authenticated couple artwork is reused separately.
