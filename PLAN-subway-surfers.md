# Subway Surfers gameplay mode

Status: implemented and validated with generated media. Import and border trimming
of the selected footage remain blocked on cloud network access to YouTube.

Selected clip: https://www.youtube.com/watch?v=eRXE8Aebp7s. Prefer no black borders;
the player fills its window without stretching, and any encoded bars need a
measured crop when the footage can be fetched.

Implementation validation: 38 unit/API tests passed, both frontend entries built,
and dashboard, three-viewer feed, and two-viewer gameplay smoke tests passed in
headless Chromium. The gameplay smoke also verified the Vite media/control proxy.
Native Windows/WSL playback and the actual selected clip have not been validated.

## Goal and working assumptions

Add **Subway Surfers** to the existing platform selector so a dedicated viewer can
loop gameplay footage while OpenCode works. Reuse Start, Stop, Open, Quit, and the
existing Pause/Close preference.

The working assumption is prerecorded gameplay as a selectable alternative to the
social feeds. A playable game or gameplay displayed simultaneously beside a feed
would need a different scope. The initial version uses one looping clip, muted by
default, in the existing one-to-three viewer layout.

Development and automated checks stay in the cloud checkout. This feature does not
require connecting to the user's computer or reading their browser profiles.

## Intended behavior

| Event | Gameplay behavior |
| --- | --- |
| Watcher starts | Automation stays disabled; no viewer opens. |
| Start while OpenCode is active | Open or reuse viewers and play the clip. |
| Start while idle | Open paused; apply the existing delayed Close preference if selected. |
| OpenCode becomes idle, with Pause selected | Pause the video immediately, retaining its position. |
| OpenCode becomes idle, with Close selected | Pause immediately, then close after `autoCloseDelayMs`; new work cancels closure. |
| A new task starts while automation is enabled | Resume an existing paused viewer, or reopen a closed viewer from the beginning. |
| Stop | Pause immediately or close immediately, according to the preference; later tasks cannot resume until Start. |
| OpenCode disconnects | Pause without assuming the task ended or closing the viewer; reconcile before resuming. |
| Open player | Open or reuse the viewer without enabling automation; stay paused unless automation is already eligible. |
| A viewer is manually closed | Preserve the current rule: reopen on the next task, Start, or explicit Open. |
| Clip ends while playback is eligible | Loop automatically. |
| Platform changes | Require Stop, close the previous viewers, and persist the selection. |
| Quit watcher | Close the utility's viewers and stop playback work. |

For this mode, hide the Auto-scroll toggle and use playback-specific status text.
Its existing session value remains available when switching back to a social feed.
Gameplay eligibility depends on enabled + connected + active, independently of
the feed's Auto-scroll setting. Playback starts only after that eligibility is
established; do not add unconditional video autoplay on page load.

## What the existing code requires

- `src/platforms.js` defines the three feed destinations, route guards, and
  ArrowDown advancement. `ui/main.jsx` currently duplicates their display names.
- `src/settings.js` validates the selected platform against that registry and
  already persists it atomically in `runtime/settings.json`.
- `src/controller.js` manages lifecycle races, the scroll timer, and Pause/Close.
  **Pause currently stops advancement; it does not pause the underlying video.**
  Gameplay therefore needs explicit play/pause transitions.
- `src/main.js`, `src/controller.js`, and recovered viewers in `src/viewer.js`
  currently expect every platform to have a fixed external URL.
- `src/server.js` serves built frontend files and small JSON control requests.
  It has no streaming media route or byte-range handling.
- `vite.config.js` builds the dashboard and proxies `/api` to the backend.
- Some tests iterate over every platform assuming a social feed. Those assumptions
  must become capability-specific when the new mode is added.

## Implementation steps

### 1. Supply and serve a gameplay clip

- Use an explicitly supplied MP4 clip at
  `runtime/media/subway-surfers.mp4` in the environment running the app. Keep large
  media in the existing ignored `runtime/` directory. Document the preferred
  browser-compatible video format and how to supply or replace the clip.
- The actual gameplay clip is still needed. Select user-provided footage or a
  source permitted for this use before declaring the feature complete. Automated
  tests can use a small generated video fixture while the real clip is pending.
- Add a fixed `GET`/`HEAD /api/media/subway-surfers` route before generic JSON API
  dispatch. Stream only this known file, with `video/mp4`, content length, and
  single byte-range support (`206`, `Content-Range`, and `416` as appropriate).
  Avoid buffering the entire video or accepting arbitrary filesystem paths.
- Retain the existing loopback host checks. The existing Vite `/api` proxy should
  forward the media route as well; verify range headers and responses through it.
- Report missing, unreadable, or unsupported media clearly in the player and
  dashboard. The other modes should remain usable if no gameplay clip is present.

### 2. Add the mode and player page

- Add a `subwaySurfers` entry with explicit capabilities such as `kind:
  'looping-video'` and `supportsAutoScroll: false`. Keep feed capabilities explicit.
- Centralize destination resolution so the gameplay URL uses the configured
  `controlPort`, for example `/gameplay.html`, rather than hardcoding port 4097.
  Use the resolver for startup, platform switching, and recovered-viewer checks.
- Add a small player entry (`gameplay.html`, `ui/gameplay.jsx`, and styles) and
  configure Vite to build it alongside the dashboard. Render a muted, looping,
  inline video using `/api/media/subway-surfers` with a loading/error state.
- Keep the player portrait-friendly and responsive to the existing viewer sizes.
  Catch rejected `play()` calls and decoding failures; never report playback as
  successful solely because a window opened.
- Share frontend-safe platform labels/capabilities with the dashboard to avoid
  maintaining another independent list. Preserve existing saved settings and
  invalid-value fallback behavior.

### 3. Integrate playback with the controller

- Extend the viewer interface with explicit playback synchronization, e.g.
  `setPlayback(playing, stillAllowed)`, implemented through CDP against the owned
  gameplay page. Never send ArrowDown events to this mode.
- Separate playback eligibility from scroll eligibility. Synchronize video state
  on Start, Stop, activity transitions, disconnect/reconnect, manual Open, viewer
  readiness, and shutdown; do not wait for the scroll interval.
- Use the existing serialized operations and generation checks. Recheck current
  eligibility after asynchronous page readiness and immediately before `play()`
  so Stop, disconnect, or a platform change cannot be undone by a late operation.
- Preserve idle-close cancellation, concurrent-session handling, and the rule for
  manually closed viewers. Apply playback commands only to surviving viewers;
  playback reconciliation must not continuously recreate closed windows.
- Surface playback loading/errors in status. Keep `scrollingEligible` meaningful
  for feeds and provide the mode-aware state the dashboard needs to display
  Playing, Paused, or a failure accurately.

### 4. Adapt the dashboard and documentation

- Add the Subway Surfers option and hide feed-only scrolling controls when selected.
- Change Open / Login to Open player and replace sign-in guidance with gameplay
  guidance for this mode. Keep the existing controls and labels for social feeds.
- Explain the missing-clip state and playback rules in the UI without exposing
  filesystem paths as ordinary product guidance. Put installation paths and media
  provisioning steps in `README.md`.
- Document that Pause resumes from the current position while closing a viewer
  resets playback on the next open. Update startup/build guidance for the second
  frontend entry.

## Validation and acceptance

- Extend settings/API tests for the new mode, persistence, old settings, invalid
  values, switching only after Stop, and a nondefault control port.
- Add media-route checks for GET, HEAD, byte ranges, invalid ranges, a missing
  clip, and rejection of attempts to address other files. Verify streaming through
  both the backend and Vite.
- Extend controller tests for active/idle playback, both Pause/Close preferences,
  Stop during page loading, disconnect/reconnect, overlapping sessions, cancelled
  idle closure, manual closure, shutdown, and absence of gameplay scroll events.
- Add a real-browser gameplay smoke test using a small known playable fixture.
  Verify decoded frames or advancing `currentTime`, looping, stable paused time,
  resume, and no playback after Stop or disconnect. Merely checking a `play()` call
  or a running flag is insufficient.
- Extend dashboard smoke coverage for selection, persisted reload, mode-specific
  controls, playback status, missing media, and switching back to a feed.
- Keep the existing feed guard and live-platform tests scoped to feed capabilities;
  test gameplay separately instead of accidentally running it as another feed.
- Run `npm test`, `npm run build`, `npm run test:dashboard`,
  `npm run test:browser`, and the new gameplay smoke command from the activated
  cloud environment. Check the actual supplied gameplay clip after fixture tests.
- Treat native Windows/WSL popout behavior as a separate manual check in the
  documented desktop environment; headless cloud tests do not establish that result.

The feature is complete when a supplied Subway Surfers clip follows the behavior
table, failures are visible and recoverable, and the existing feed checks still
pass. The plan itself requires no media download or access to a personal device.
