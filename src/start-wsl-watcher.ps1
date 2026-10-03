# Called by the WSL launcher; keep stdout reserved for the shared port.
$ErrorActionPreference = 'Stop'
try {
    $reelsRoot = Split-Path -Parent $PSScriptRoot
    # start.cmd uses cmd's drive cwd, so keep this utility on a Windows drive.
    if ($reelsRoot.StartsWith('\\')) {
        throw 'Keep reels-while-thinking on a Windows drive (e.g. /mnt/c). The OpenCode project may be anywhere in WSL.'
    }
    $port = & node (Join-Path $PSScriptRoot 'port.js')
    if ($LASTEXITCODE -ne 0) { throw 'Could not read the shared port from config.json.' }
    if ("$port" -notmatch '^\d+$') { throw 'Invalid shared port.' }
    # This console is interactive: O/S/Q control the existing Windows watcher.
    Start-Process -FilePath $env:ComSpec -WorkingDirectory $reelsRoot -ArgumentList '/d /c start.cmd'
    Write-Output $port
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
