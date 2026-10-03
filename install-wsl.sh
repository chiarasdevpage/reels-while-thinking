#!/usr/bin/env bash
set -euo pipefail

fail() { printf 'Reels setup: %s\n' "$*" >&2; exit 1; }

command -v wslpath >/dev/null && command -v powershell.exe >/dev/null ||
  fail 'Run this setup inside WSL with Windows interop enabled.'

launcher_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
bin_dir=$HOME/.local/bin
wrapper=$bin_dir/brainrot
marker='# Reels While Thinking brainrot wrapper'

# Do not replace an unrelated command or follow an existing symlink.
if [[ -e $wrapper || -L $wrapper ]]; then
  [[ -f $wrapper && ! -L $wrapper ]] && grep -qxF "$marker" "$wrapper" ||
    fail "$wrapper already exists and is not a Reels wrapper. Move it aside before running setup."
fi

mkdir -p -- "$bin_dir"
{
  printf '#!/usr/bin/env bash\n%s\n' "$marker"
  # Bash quoting handles spaces, apostrophes, and shell metacharacters in paths.
  # Only the launcher path is fixed; cwd, PATH, and arguments come from the user.
  printf 'exec bash %q "$@"\n' "$launcher_dir/opencode-with-reels.sh"
} > "$wrapper"
chmod +x -- "$wrapper"
printf 'Installed %s\n' "$wrapper"

case ":$PATH:" in
  *":$bin_dir:"*) ;;
  *)
    user_shell=${SHELL:-}
    case ${user_shell##*/} in
      bash) shell_rc=$HOME/.bashrc ;;
      zsh) shell_rc=${ZDOTDIR:-$HOME}/.zshrc ;;
      *) shell_rc= ;;
    esac
    if [[ -n $shell_rc ]]; then
      path_marker='# Reels While Thinking: brainrot on PATH'
      if ! grep -qxF "$path_marker" "$shell_rc" 2>/dev/null; then
        printf '\n%s\n%s\n' "$path_marker" \
          'case ":$PATH:" in *":$HOME/.local/bin:"*) ;; *) export PATH="$HOME/.local/bin:$PATH" ;; esac' >> "$shell_rc"
      fi
      printf 'PATH configured in %s. Open a new terminal, or run:\n' "$shell_rc"
    else
      printf 'Add ~/.local/bin to your shell PATH. For Bash/Zsh, run:\n'
    fi
    printf '  export PATH="$HOME/.local/bin:$PATH"\n'
    ;;
esac
printf 'From your project directory, run: brainrot\n'
