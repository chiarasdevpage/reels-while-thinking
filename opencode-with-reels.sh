#!/usr/bin/env bash
set -euo pipefail

fail() { printf 'Reels launcher: %s\n' "$*" >&2; exit 1; }

command -v wslpath >/dev/null && command -v powershell.exe >/dev/null ||
  fail 'Run this launcher inside WSL with Windows interop enabled.'

# WSL can inherit an npm Windows shim named "opencode". Prefer the native install
# and require an ELF executable so that we never fall through to that shim.
opencode_bin=${OPENCODE_BIN:-}
if [[ -z $opencode_bin ]]; then
  if [[ -x $HOME/.opencode/bin/opencode ]]; then
    opencode_bin=$HOME/.opencode/bin/opencode
  else
    opencode_bin=$(type -P opencode || true)
  fi
fi
[[ -f $opencode_bin && -x $opencode_bin ]] ||
  fail 'Linux OpenCode was not found. Set OPENCODE_BIN to its absolute binary path.'
[[ $(LC_ALL=C head -c 4 -- "$opencode_bin") == $'\177ELF' ]] ||
  fail 'OPENCODE_BIN/opencode must be a native Linux ELF binary, not a Windows/npm wrapper.'

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
