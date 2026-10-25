# Reels While Thinking

A localhost React dashboard that opens dedicated Instagram Reels, YouTube Shorts, TikTok, or looping Subway Surfers gameplay viewers while OpenCode works. Uses Node.js 22+ and installed Edge/Chrome. No extensions, account automation, or global configuration changes.

## Setup and startup

In this repository, run:

```powershell
npm.cmd install
npm.cmd run build
```

From the project where you use OpenCode, run:

```powershell
& 'C:\Users\super\projects\reels-while-thinking\opencode-with-reels.cmd'
```

The launcher starts OpenCode in your current project with its local API on the configured port (4096 by default), and opens the dashboard at **http://127.0.0.1:4097**. Normal OpenCode arguments may follow the launcher path. Use one watcher and one OpenCode server on those ports at a time.

Select a platform, use **Open / Login** to sign in manually, then press **Start**. Each dedicated viewer uses its own persistent login profile, separate from your normal browser. With multiple popouts, sign into each once.

You can also double-click `start.cmd` or run `npm.cmd start`, then start OpenCode separately:

```powershell
opencode.cmd --hostname 127.0.0.1 --port 4096
```

For a headless server, set its port in `config.json` and use `opencode.cmd attach http://127.0.0.1:4096`. A plain OpenCode instance on a random port is not detected. The watcher waits and reconnects if OpenCode has not started.

Use the printed dashboard URL if the browser does not open automatically. Rebuild after frontend changes. The `.cmd` commands work without changing PowerShell execution policy.

## Controls

| Control | Action |
| --- | --- |
| Start | Open/reuse viewers and enable automation; scrolling waits for OpenCode activity |
| Stop | Disable automation until Start is pressed again |
| Platform | Instagram Reels, YouTube Shorts, TikTok, or Subway Surfers; stop automation before switching |
| When idle or stopped | **Pause** leaves viewers open; **Close** closes them |
| Auto-scroll | Toggle advancing independently from automatic window management |
| Open / Login | Open viewers for manual viewing/login without enabling automation |
| Quit watcher | Close this utility's viewers and shut down the backend |

The watcher starts **disabled** each launch; auto-scroll starts **on**. The shared Pause/Close setting applies to idle transitions and manual Stop. Idle pauses resume automatically with the next OpenCode task. Manual Stop never resumes automatically.

Idle Close uses `autoCloseDelayMs` (3 seconds by default); manual Stop closes immediately. New work cancels pending idle closure. Idle setting changes apply immediately. Changing platforms closes existing viewers; Start or Open/Login opens the new destination.

Start while idle opens the page for Pause; Close applies the idle delay. Open/Login cancels idle closure so you can sign in manually. Closing a viewer manually keeps it closed for that task; the next task, Start, or Open/Login restores it.

**Typing** means the whole OpenCode task, including tools, retries, and permission waits. **Running** means scrolling is eligible; dialogs, focused inputs, or unavailable videos can still prevent advancement. Disconnection pauses scrolling without assuming the task finished.

Closing the dashboard tab does not quit the watcher. Use **Quit watcher** for clean shutdown. Optional terminal shortcuts remain: **O** opens viewers, **S** toggles scrolling, and **Q/Ctrl+C** quits. OpenCode and Ollama are never stopped. The loopback HTTP port also prevents duplicate watcher instances.

## Subway Surfers gameplay

Select **Subway Surfers**, then use **Open player** to check the clip or **Start**
to enable playback while OpenCode works. The clip loops, starts muted, and fills
the viewer while preserving its aspect ratio. The Auto-scroll toggle is hidden
for this mode; its previous value is kept when you switch back to a social feed.

Place your gameplay MP4 in `runtime/media/subway-surfers.mp4` on the machine running
the watcher, creating `runtime/media` if needed. H.264 video with `yuv420p` pixel
format is recommended; audio is optional. The file is ignored by Git, is streamed
locally with byte-range support, and is not copied into the frontend build. No
video or browser account is downloaded automatically, and cloud development does
not need access to files on your personal computer.

The development cloud environment has a supplied gameplay clip installed at that
path: about 22 minutes of 1920×1080 H.264 footage at 60 fps. The opening logo and
trailing menus were trimmed with stream copying, preserving video quality; the
original upload remains in `runtime/imports/subway-surfers-original.mp4`. Sampled
gameplay had no encoded black borders. Import details and checksums are retained
locally in `runtime/media/import-info.json`.

The clip is not bundled in Git. A fresh checkout needs its own MP4 at the path
above; a YouTube or Drive watch URL is not a playable local file. Publish the
prepared cloud environment to retain the imported media in its snapshot. The
player reports a missing clip when no file has been supplied.

The player uses `object-fit: cover` to avoid adding black bars and may crop the
edges to fill your chosen window size. Bars already encoded in the source video
need trimming before import. With FFmpeg installed, inspect a representative
section using `ffmpeg -i input.mp4 -t 20 -vf cropdetect -an -f null -`, verify the
suggested crop against several parts of the clip, then convert with that measured
`crop=w:h:x:y` filter, `-c:v libx264 -pix_fmt yuv420p -an -movflags +faststart`.
Write the result to a new file first, then place it at the path above with the
watcher stopped. Do not replace gameplay with the generated test pattern.

In gameplay mode, **Pause** actually pauses the video and preserves its position.
Idle **Close** pauses immediately, then uses `autoCloseDelayMs`; new work cancels
the pending closure. Manual Stop with Close closes immediately. Reopening a closed
viewer starts the clip again from the beginning. Disconnection pauses playback
until OpenCode reconnects. Manual Stop requires Start before any task can resume
playback. Open player opens paused when automation is disabled and does not enable
it. A manually closed viewer stays closed for the current task.

Loading and media errors appear in the player and dashboard. After supplying or
replacing the clip, use **Reload player** or Stop/Close and Open player to retry.
Run `npm run build` to build both the dashboard and `gameplay.html`; the backend
and Vite both serve the player and its `/api/media/subway-surfers` stream. Desktop
viewers use the backend's configured `controlPort`, including nondefault ports.

## Windows ARM64 / WSL

On Windows ARM64, install native Linux ARM64 OpenCode **inside WSL**. The watcher still runs on Windows and requires Windows Node.js and Edge/Chrome. Keep this utility on a Windows drive and perform the npm setup/build above on Windows.

Run this one-time setup in WSL, adjusting the checkout path:

```bash
bash /mnt/c/Users/super/projects/reels-while-thinking/install-wsl.sh
```

It installs `~/.local/bin/brainrot` and adds that directory to Bash/Zsh PATH if needed. Open a new terminal, then run from any project:

```bash
cd /path/to/project
brainrot
```

Normal OpenCode arguments may follow `brainrot`. The launcher preserves the current project and argument boundaries. It discovers OpenCode through `command -v opencode` and requires a native Linux ELF binary, rejecting inherited Windows wrappers. Re-run setup if you move this checkout.

The wrapper invokes `opencode-with-reels.sh`, which reads the shared port through Windows Node.js and starts the Windows watcher with its console hidden. Control it through the dashboard. Linux Node.js is not required; WSL Windows interop and Windows-to-WSL localhost connectivity are required. WSL 2 needs localhost forwarding enabled.

Change the OpenCode port in `config.json`; the WSL launcher rejects `--port` and `--hostname` overrides. If the watcher reconnects continuously, check Windows can reach `http://127.0.0.1:4096/global/health`. Leave `opencode.directory` empty to watch all projects, or use the **Linux** path reported by OpenCode.

Exported `OPENCODE_SERVER_PASSWORD` and optional `OPENCODE_SERVER_USERNAME` are forwarded to the watcher. Exiting OpenCode leaves the watcher running; use **Quit watcher** before launching again. The PowerShell execution-policy override is local to the helper process.

## Settings and local data

Platform and idle behavior save atomically in **`runtime/settings.json`**. Missing or corrupt settings fall back to Instagram and Pause; invalid fields fall back independently. Write failures appear in the dashboard. Auto-scroll and automation enabled state are session-only.

Advanced settings stay in **`config.json`** and require a restart:

| Setting | Meaning |
| --- | --- |
| `popouts` | 1?3 viewers, shared across active tasks |
| `width`, `height` | Outer viewer dimensions in desktop pixels |
| `left`, `top`, `gap` | Window layout; negative coordinates support other monitors |
| `autoScrollIntervalMs` | Time between ArrowDown presses; existing value is preserved |
| `autoCloseDelayMs` | Idle close delay; new work cancels it |
| `browserPath` | Empty discovers Edge/Chrome; otherwise the full executable path |
| `opencode.url` | Local API origin; default http://127.0.0.1:4096 |
| `opencode.directory` | Empty watches all projects on the server |
| `opencode.reconnectMs` | Reconnect delay, default 2000 ms |
| `opencode.reconcileMs` | Status reconciliation interval, default 5000 ms |
| `controlPort` | Loopback dashboard/API and singleton listener, default 4097 |

Legacy `targetUrl`, `autoClose`, and `autoScroll` remain readable for standalone test compatibility. Normal app behavior uses the platform registry, persisted Pause/Close setting, and session-only auto-scroll toggle.

The detector consumes OpenCode `/global/event` busy/retry/idle events and reconciles `/session/status`. Live events take precedence over older snapshots. Existing overlapping-session behavior is preserved. Direct Ollama requests are not watched. After restart, active tasks in other projects may be discovered on their next session event; start the watcher before submitting work.

Each viewer uses Chromium's local DevTools protocol and `runtime/profile-N`. Only dedicated viewers receive keyboard input; no desktop-wide keys or coordinate clicks are used. Recovered viewers are checked against the selected platform. Scrolling requires a visible video, a supported route, no visible dialog, and no focused input. Login, consent, an initial play/click, or site changes can block scrolling; no challenge is bypassed.

Logs rotate under `logs/reels.log`. They do not include prompts, completions, cookies, or model responses. Login data remains in the dedicated profiles. Treat these like browser account data. Minimized windows and browser throttling can affect playback.

No service or scheduled task is installed. To uninstall, quit the watcher and delete the checkout. Optionally remove the WSL wrapper and marked PATH block. Delete `runtime/profile-N` only with the watcher/viewers stopped to reset a login; normal browser profiles are untouched.

## Development and checks

```powershell
npm.cmd test
npm.cmd run build
npm.cmd run test:browser
npm.cmd run test:dashboard
npm.cmd run test:gameplay
npm.cmd run test:platforms
```

Normal startup serves bundled React assets from the backend. For frontend development, run the backend plus `npm.cmd run dev`; Vite proxies API requests to the configured control port.

The unit/API suite covers lifecycle races, detector reconciliation, SSE, settings persistence, errors, and scroll gates. Browser tests use isolated profiles. The dashboard smoke test uses a real browser with a fake automation viewer and checks all controls; its screenshot is `runtime/dashboard-smoke/dashboard.png`.

The platform smoke test uses separate unauthenticated profiles and records actual advancement or blockers with screenshots under `runtime/platform-smoke/`. Fixture success alone does not prove live-site advancement. Sign in yourself in normal viewer profiles for personalized feeds.

`npm run test:gameplay` uses an isolated media directory and the tiny generated
`test/fixtures/gameplay.mp4` (not Subway Surfers footage). It exercises real video
decoding and looping in two browsers, idle/Stop/disconnect pause and resume,
missing/invalid media recovery, manual closure, delayed Close, and Vite's player,
range streaming, and control proxy. It needs the production build and a configured
Chromium browser, but no download, FFmpeg installation, or production gameplay
file. Evidence is saved under `runtime/gameplay-smoke/`. Verify the supplied
gameplay clip separately after importing it.

To run the same checks against the installed footage:

```bash
npm run test:gameplay -- --media runtime/media/subway-surfers.mp4
```

This copies the supplied clip into the isolated smoke-test directory; it does not
overwrite the original. The test seeks near the end to verify looping and checks
decoded playback at 10%, 50%, and 90% of long clips. Results identify generated
versus supplied media in `runtime/gameplay-smoke/result.json`. Each run removes
the previous result before starting, so a failed run cannot leave a stale pass.

Optional existing checks: `node test/opencode-smoke.js` uses an isolated OpenCode/Ollama session; `node test/instagram-smoke.js` checks public Reels. In WSL, run `python3 /mnt/c/Users/super/projects/reels-while-thinking/test/wsl-launcher-test.py` for wrapper regression coverage.

## API and architecture

The React UI polls `GET /api/status` once per second. JSON commands:

- `POST /api/start`, `/api/stop`, `/api/open`, `/api/shutdown`
- `PATCH /api/settings`: `platform` and/or `idleBehavior`
- `PUT /api/auto-scroll`: `{"enabled":true}`
- `GET` / `HEAD /api/media/subway-surfers`: the local gameplay MP4; GET supports a single byte range

Status includes `playbackEligible` and, for gameplay, a `playback` object with
`state` (`closed`, `loading`, `paused`, `playing`, or `error`) and `error`.
`scrollingEligible` remains false for gameplay; `automation` reflects observed
playback as well as task eligibility. For feeds, `playback` is null.

Use the displayed 127.0.0.1 origin. Mutations reject cross-origin browser requests and non-JSON payloads. Status includes connection/activity, enabled state, scrolling eligibility, settings, auto-scroll, pending operations, and the latest error.

The detector only reports activity and connection. The controller owns lifecycle, serialized browser operations, status, and settings updates. Platform URLs and guards live in `src/platforms.js`; the existing CDP viewer owns browser control. Codex, Claude Code, new detection heuristics, and account automation remain outside this phase.

## Gameplay validation — 2026-10-24

- Unit/API tests: 38 passed.
- Production build: dashboard and gameplay entries passed.
- Headless Chromium: dashboard, three-viewer scrolling, and two-viewer gameplay
  smoke tests passed, including Vite media streaming and control requests.
- Gameplay checks used the generated fixture. The selected YouTube clip, its
  encoded borders, and native Windows/WSL gameplay remain unverified.

## Earlier validation status — 2026-10-05

- Production build: passed.
- Node unit/API regression suite: 26 passed.
- WSL launcher suite: 11 passed.
- Real-browser dashboard smoke test: passed all controls, reload, and connection-state checks.
- Instagram live check: video advancement observed in the latest run.
- YouTube Shorts and TikTok live checks: browser disconnected; advancement remains unverified.
- The local three-viewer keyboard smoke test received no key events in this environment. The original committed viewer and test reproduced the same failure in an isolated baseline run. No desktop-input workaround or simulated success was introduced.

Live-platform acceptance is therefore still incomplete. Evidence is saved in `runtime/platform-smoke/result.json` and the dashboard screenshot in `runtime/dashboard-smoke/dashboard.png`. Re-run the browser/platform checks in a normal desktop session after manual login or consent as needed.
