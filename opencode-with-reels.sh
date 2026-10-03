#!/usr/bin/env bash
set -euo pipefail

fail() { printf 'Reels launcher: %s\n' "$*" >&2; exit 1; }

# WSL can inherit an npm Windows shim named "opencode". Require an ELF
# executable so that PATH discovery never launches that shim.
opencode_bin=$(command -v opencode || true)
[[ -f $opencode_bin && -x $opencode_bin ]] ||
  fail 'OpenCode was not found. Install OpenCode inside WSL/Linux and ensure opencode is on your Linux PATH, then retry.'
[[ $(LC_ALL=C head -c 4 -- "$opencode_bin") == $'\177ELF' ]] ||
  fail 'opencode on PATH must be a native Linux ELF binary. Install OpenCode inside WSL/Linux and put it before Windows/npm wrappers on PATH.'

command -v wslpath >/dev/null && command -v powershell.exe >/dev/null ||
  fail 'Run this launcher inside WSL with Windows interop enabled.'

for arg in "$@"; do
  case $arg in
    --port|--port=*|--hostname|--hostname=*)
      fail 'Set the shared port in config.json; --port and --hostname cannot override the watcher connection.' ;;
  esac
done

# Resolve only the helper's location in a subshell; retain the caller's cwd.
launcher_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
helper=$(wslpath -w "$launcher_dir/src/start-wsl-watcher.ps1")
# Forward optional server authentication to the Windows watcher as well.
export WSLENV="${WSLENV:+$WSLENV:}OPENCODE_SERVER_PASSWORD/w:OPENCODE_SERVER_USERNAME/w"
port=$(powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$helper") ||
  fail 'Could not start the Windows watcher.'
port=${port//$'\r'/}
[[ $port =~ ^[0-9]+$ ]] && (( port >= 1 && port <= 65535 )) ||
  fail 'The Windows watcher helper did not return a valid shared port.'

exec "$opencode_bin" --hostname 127.0.0.1 --port "$port" "$@"
