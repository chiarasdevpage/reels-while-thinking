# Reels While Thinking

A small Windows utility that opens dedicated Instagram Reels windows when OpenCode starts working. Uses the installed Edge (or Chrome) and Node.js; **no npm packages, extensions, proxy, or global configuration changes**.

## Start

1. Open a terminal in the project where you normally use OpenCode.
2. Run the launcher:

   ```powershell
   & 'C:\Users\super\projects\reels-while-thinking\opencode-with-reels.cmd'
   ```

   It opens the watcher console and launches OpenCode in your current project with its local API on port 4096. Normal OpenCode arguments can follow the launcher path. Use one OpenCode server on this port at a time.

3. In the **watcher console**, press **O** to open the viewer and sign into Instagram yourself. Each popout has its own persistent login profile, separate from your normal browser. With multiple popouts, sign into each once.
4. Submit a task in OpenCode. The viewer opens automatically, or reuses existing popouts. Default: one 420 × 760 window, no scrolling, left open when the task finishes.

You can also double-click `start.cmd`, then launch OpenCode separately:

```powershell
opencode.cmd --hostname 127.0.0.1 --port 4096
```

For an existing headless server, set its port in `config.json`, start the watcher, and use `opencode.cmd attach http://127.0.0.1:4096`. A plain OpenCode instance on a random port is not watched automatically. The watcher waits and reconnects if OpenCode has not started yet.

PowerShell may block `npm.ps1` and `opencode.ps1` on this VM. These instructions use `.cmd` launchers and do not change your execution policy.

### WSL (native Linux ARM64 OpenCode)

Keep this utility on the Windows drive, and run its Bash launcher from your project inside WSL:

```bash
cd ~/your-project
/mnt/c/Users/super/projects/reels-while-thinking/opencode-with-reels.sh
```

Normal OpenCode arguments can follow the launcher path. Your current directory and argument boundaries are preserved, including projects in the Linux filesystem and paths with spaces. The launcher prefers `~/.opencode/bin/opencode`, then searches `PATH`; it requires a native Linux ELF binary to avoid accidentally using the inherited Windows npm shim. To select another Linux installation:

```bash
OPENCODE_BIN=/absolute/path/to/linux/opencode /mnt/c/Users/super/projects/reels-while-thinking/opencode-with-reels.sh
```

The launcher uses `powershell.exe` to read the port through the existing `src/port.js` and open the existing Windows `start.cmd` watcher, then replaces itself with Linux OpenCode in your terminal. It does not need Linux Node.js. Windows Node.js and Edge/Chrome must be installed, and WSL Windows interop must be enabled. PowerShell's execution-policy override applies only to this helper process.

The watcher and OpenCode share `config.json`'s port (4096 by default). Change it there; the WSL launcher rejects `--port` and `--hostname` overrides. Use one OpenCode server and one watcher at a time. This uses Windows-to-WSL localhost connectivity (WSL 1, or WSL 2 with localhost forwarding enabled). If the watcher keeps reconnecting, check that Windows can reach `http://127.0.0.1:4096/global/health`. Keep `opencode.directory` empty to watch all projects, or set it to the **Linux** project path reported by OpenCode, such as `/home/super/your-project`.

Optional `OPENCODE_SERVER_PASSWORD` and `OPENCODE_SERVER_USERNAME` exported in WSL are forwarded to the watcher. Use **O/S/Q** in the Windows watcher console as above. Exiting OpenCode leaves the watcher running; quit it with **Q** before launching again.

The `.sh` file is executable and uses LF line endings. If a fresh Windows checkout loses its executable permission, run `chmod +x /mnt/c/Users/super/projects/reels-while-thinking/opencode-with-reels.sh` in WSL.

## Controls and stopping

Focus the watcher console and press:

| Key | Action |
| --- | --- |
| O | Open/reuse popouts for login or manual viewing |
| S | Toggle auto-scroll immediately, for this run |
| Q or Ctrl+C | Stop watching and close only this utility's popouts |

Closing an individual viewer manually keeps it closed for the rest of that task. The next task, or **O**, restores missing windows. Quitting OpenCode disconnects the watcher and stops scrolling; press **Q** in the watcher to quit it too. Use **Q/Ctrl+C** for clean shutdown; force-closing its console can leave dedicated browser windows open, which you can close manually or recover on the next run.

No startup service or scheduled task is installed. OpenCode and Ollama are never stopped by the watcher. A local port lock prevents two watcher instances from opening duplicate windows.

## Settings

Edit **`config.json`**, then restart the watcher. Values are validated before it starts.

| Setting | Meaning |
| --- | --- |
| `popouts` | 1–3 simultaneous windows, shared across active tasks |
| `width`, `height` | Outer browser-window size in desktop pixels |
| `left`, `top` | First window's screen position; negative values support monitors left/above the primary monitor |
| `gap` | Horizontal space between windows; subsequent windows go to the right |
| `targetUrl` | Defaults to `https://www.instagram.com/reels/` |
| `autoScroll` | `true` enables advancing while a task is active; default `false` |
| `autoScrollIntervalMs` | Milliseconds between ArrowDown presses; default 15000 |
| `autoClose` | Close viewers after all tasks finish; default `false` |
| `autoCloseDelayMs` | Delay before closing; default 3000; new work cancels a pending close |
| `browserPath` | Empty finds Edge/Chrome automatically; otherwise the full `.exe` path |
| `opencode.url` | Local OpenCode HTTP API origin; default `http://127.0.0.1:4096` |
| `opencode.directory` | Empty watches every project on that server; a full project path restricts events to that project |
| `opencode.reconnectMs` | Retry delay after disconnect; default 2000 |
| `opencode.reconcileMs` | Status reconciliation interval; default 5000 |
| `controlPort` | Local singleton lock only; default 4097; no remote-control API |

For three viewers, make sure the positions fit your VM desktop; for example, width 360 and gap 12 need about 1100 pixels. Windows may adjust offscreen coordinates or size for display scaling and minimum sizes.

If your OpenCode server uses `OPENCODE_SERVER_PASSWORD`, launch the watcher with the same environment variable (and `OPENCODE_SERVER_USERNAME` if customized). Credentials are sent only to the configured loopback server and are not written to the log. Do not put passwords in the URL.

## Detection and window behavior

Verified against **OpenCode 1.18.33** on this VM. The watcher consumes **`/global/event`** and its `session.status` events (`busy`, `retry`, `idle`). A task starts when a session first becomes busy; retries, streamed tokens, model tool steps, and overlapping sessions do not create extra groups of windows. A task is the whole OpenCode session turn, including tool execution and permission waits, rather than each individual inference request. Cloud-provider tasks on the same watched server also trigger it; direct requests to Ollama outside OpenCode do not.

`/session/status` reconciles startup and reconnect state and repairs missed finish events. Live events take precedence over an older status request. Auto-scroll pauses on connection loss. Existing popouts remain until a confirmed idle state (if auto-close is enabled) or you quit. Known project directories are reconciled; after a watcher restart, an already-running task in another project is discovered on its next session event. Start the watcher before submitting tasks to catch every start.

Each viewer is an app-style Edge window with its own data directory under `runtime/profile-N`. Control uses Chromium's local DevTools protocol on an automatically chosen loopback port. The utility never sends desktop-wide keyboard input or uses screen coordinates for clicks. It reuses viewers across tasks, so leaving windows open will not accumulate more windows.

Auto-scroll sends **ArrowDown to the viewer page** only while work is active, a video is visible, the page is at the configured URL, no dialog is open, and no input has focus. Instagram may require login, cookie consent, manually selecting/playing a Reel, or an initial click before its keyboard shortcuts work. Login challenges and Instagram layout/shortcut changes cannot be bypassed by this utility. If a Reel does not advance, try ArrowDown inside the viewer and check `scroll.skipped` in the log. **S** disables automatic input immediately. Minimized windows and browser background throttling may affect playback.

## Logs and local data

`logs/reels.log` records task starts/finishes, source events, session IDs, project directories, connections, window actions, and scrolling. It rotates at about 2 MB and keeps one previous file. It does not log prompts, completions, cookies, or model responses. Instagram login cookies stay in the dedicated browser profiles, which should be treated like normal browser account data.

To uninstall: quit the watcher, close its viewers, and delete this project directory. Deleting `runtime/profile-N` while the watcher and its windows are stopped resets that popout's Instagram login. Normal browser profiles and OpenCode configuration are untouched.

## Verification / development

Requires Windows with Edge/Chrome and Node.js 22 or later (VM inspected with Node 26.2.0). No `npm install` is needed.

```powershell
npm.cmd test
npm.cmd run test:browser
node test/opencode-smoke.js
node test/instagram-smoke.js
```

From WSL, run `python3 /mnt/c/Users/super/projects/reels-while-thinking/test/wsl-launcher-test.py` for launcher regression checks (Python 3 required for tests only). These substitute the Windows bridge to check argument/port handling, native-binary guards, working directory, authentication forwarding, and failures without opening windows. The live WSL check also verified Linux OpenCode 1.18.34's TUI, Windows loopback connectivity, and a real Ollama task triggering a Reels popout from a Linux project directory containing spaces.

The unit/integration suite exercises duplicate and overlapping task events, delayed close cancellation, late browser startup, scroll gates, configuration validation, fragmented SSE, and real HTTP reconnect recovery. The browser smoke test opens and closes three windows displaying local HTML and verifies dimensions, placement, reuse, keyboard delivery, and focused-input protection. The optional OpenCode smoke test uses a temporary server on port 4196 and the installed Ollama `qwen3:4b`, creates and removes its own test session, and checks the full generation-to-popout-to-idle path. Its model configuration applies only to that test process. It writes evidence to `runtime/opencode-smoke/result.json` on success.

The Instagram smoke test opens a separate test profile, loads a public Reel, and checks that auto-scroll changes the Reel URL. It saves a screenshot and a result under `runtime/instagram-smoke`. Availability depends on Instagram allowing logged-out viewing; your personalized feed requires your login. The other browser tests use local pages without using your account.
