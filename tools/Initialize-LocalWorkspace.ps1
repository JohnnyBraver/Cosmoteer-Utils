function Initialize-CosmoteerUtilsLocalWorkspace {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$RepoRoot,
        [string]$Root
    )

    $repoPath = [System.IO.Path]::GetFullPath($RepoRoot)
    if ([string]::IsNullOrWhiteSpace($Root)) {
        $Root = $env:COSMOTEER_UTILS_HOME
    }
    if ([string]::IsNullOrWhiteSpace($Root)) {
        $localBase = $env:LOCALAPPDATA
        if ([string]::IsNullOrWhiteSpace($localBase)) {
            $localBase = Join-Path $env:USERPROFILE 'AppData\Local'
        }
        $Root = Join-Path $localBase 'Cosmoteer-Utils'
    }

    $localPath = [System.IO.Path]::GetFullPath($Root)
    $relative = [System.IO.Path]::GetRelativePath($repoPath, $localPath)
    if ($relative -eq '.' -or (-not [System.IO.Path]::IsPathRooted($relative) -and $relative -ne '..' -and -not $relative.StartsWith('..\') -and -not $relative.StartsWith('../'))) {
        throw "COSMOTEER_UTILS_HOME must be outside the source repository. Repo: $repoPath; local data: $localPath"
    }

    $env:COSMOTEER_UTILS_HOME = $localPath
    @(
        'audit\role-audit',
        'analysis',
        'config',
        'reports\workbooks',
        'reports\role-write',
        'backups\ship-backups'
    ) | ForEach-Object {
        New-Item -ItemType Directory -Path (Join-Path $localPath $_) -Force | Out-Null
    }

    return $localPath
}
