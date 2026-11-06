# Verified unified music search (v13)

Release: `2.19.7-jjbitv.13`, 2026-11-06. Production: https://zhuiju.zhaxueit.cn/music.

## User-visible behavior

Search returns a single list of recordings. Platform tabs and per-row provider labels are removed. The queue is opened from the player instead of occupying a second permanent list. Existing favorites remain local to the device; legacy preview favorites are excluded.

Catalog entries are not exposed as playable results. Search groups exact title/artist matches with compatible reference durations, then verifies full audio before emitting rows over NDJSON. Different singers, live versions and materially different durations remain separate. Results have checked audio format, measured duration and a short-lived playback receipt. Search checks ten candidates at a time with three workers; further candidates are available through “继续查找”. Catalogs and successful audio checks are cached. Foreground playback and quality changes take priority over background verification.

Quality options: Auto, Standard, High, Lossless and 24bit. The player displays measured codec and bitrate. A requested lossless file must actually use a supported lossless codec; 24bit must be detected in its metadata. AAC is identified as AAC, not MP3. An explicit unsuccessful quality change keeps the previous audio and progress. A new song can fall back to already verified automatic quality, with an explicit message. Playback position is restored on successful changes.

## Source research and adapters

Reviewed 85 scripts from the supplied collections, with 68 distinct SHA-256 contents: 45 from `wzh15802/lxmusic`, 22 from `xzh767/lxmusic-source-all`, and 18 from the current `V260907` collection in `guoyue2010/lxmusic-`. These are research inputs, not 85 independent active services. The runtime never executes downloaded source JavaScript.

Eight reviewed adapter families are wired into the resolver chain: Hello World/HYW, Hello World/Tang, Sixyin's Kuwo protocol, Feichangdao/Haitang, Huibq, Xinghai/GD, Muming and VKeys. Catalogs still use stable platform IDs internally, while users see one list. `/api/music/sources` exposes adapter identity, protocol templates, source-file references and last-sample health behind site authentication. Settings → Sources → Music provides the same inventory.

References: [Huibq](https://github.com/Huibq/keep-alive), [wzh collection](https://github.com/wzh15802/lxmusic), [xzh collection](https://github.com/xzh767/lxmusic-source-all), [guoyue collection](https://github.com/guoyue2010/lxmusic-). LX behaviors reviewed as reference: [online music URL/quality caching](https://github.com/lyswhut/lx-music-desktop/blob/master/src/renderer/core/music/online.ts), [player action and stale-request handling](https://github.com/lyswhut/lx-music-desktop/blob/master/src/renderer/core/player/action.ts).

The Hello World/HYW sample for Jay Chou's “晴天” returned a genuine FLAC header, 269.7467 seconds, 24bit / 44.1kHz and approximately 1643kbps; Chromium decoded and sought it. The same endpoint's standard-quality sample returned a preview, which the full-duration check rejected. Some purported FLAC Kuwo responses contained 48kbps AAC and were rejected for lossless selection. Expired certificates were not bypassed; unauthorized, empty, unavailable and throttled endpoints were not presented as validated recordings. No DRM decryption or account permission bypass is implemented.

## Verification and bounds

`music-metadata` (MIT) parses codec, reference duration and sample precision using a bounded Range tokenizer. It reads small metadata windows and can seek to an MP4 tail without downloading the full track. Network redirects use the existing SSRF guard. HTTP MIME labels are not trusted to identify a FLAC file. The stream proxy uses the verified MIME type and retains byte-range support. Memory and network reads per probe are bounded; no whole-track server transcode/download cache is introduced.

Linux image checks: type checking, lint and 643 tests in 66 files passed. Browser flows cover a verified unified list, full decoding, seeking, switching high/lossless/24bit without resetting position, failure rollback, queue drawer, favorites, cross-page playback and 390px/1440px layouts. Search samples measured about 1992ms to first verified result and 8442ms for ten recordings for a cold “陈奕迅” search; an immediate repeat completed in about 90ms. These timings describe the deployment sample, not a permanent SLA.

Probe results cannot guarantee future upstream availability or that every catalog entry / paid recording / quality is available. Previews and unverified entries are omitted rather than being represented as complete songs.

## Deployment and rollback

- Preview backup: `/opt/backups/jjbitv-v12-preview-before-verified-music-20261106`.
- Pre-production backup: `/opt/backups/jjbitv-v11-before-music-release-20261106` (old image, configuration and consistent SQLite snapshots checked with `integrity_check`).
- Release directory: `/opt/jjbitv-v13-20261106`.
- Production container: `jjbitv-v13-final`, bound to `127.0.0.1:18096` behind the existing Nginx site. Final image: `sha256:9096cb89b79f972d798185c4ebd647a4a98e3432c6d6c1b726a0b63790f8d1d2`.
- Production data remains `/opt/jjbitv-20261024/data`; no music database schema migration is added.
- Rollback: `/opt/jjbitv-v13-20261106/rollback.sh` restarts v11 and restores old routing. Preview-cookie routing is included so existing preview browsers do not get stranded.
- Original 41 VOD interfaces, six live subscriptions, cloud credentials, and previous backups are preserved.
