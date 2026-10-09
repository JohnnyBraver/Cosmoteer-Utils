param(
    [Parameter(Mandatory = $true)]
    [string]$Library,
    [Parameter(Mandatory = $true)]
    [string]$GameBin,
    [string]$Output
)
$ErrorActionPreference = 'Stop'
$RepoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$LocalWorkspaceHelper = Join-Path $RepoRoot 'tools\Initialize-LocalWorkspace.ps1'
. $LocalWorkspaceHelper
$LocalRoot = Initialize-CosmoteerUtilsLocalWorkspace -RepoRoot $RepoRoot
if ([string]::IsNullOrWhiteSpace($Output)) {
    $Output = Join-Path $LocalRoot 'audit\role-audit'
}
$gameBinPath = (Resolve-Path -LiteralPath $GameBin).Path
$libraryPath = (Resolve-Path -LiteralPath $Library).Path
$outputPath = [System.IO.Path]::GetFullPath($Output)
New-Item -ItemType Directory -Path $outputPath -Force | Out-Null
$projectPath = Join-Path $RepoRoot 'src\CosmoteerRoleAudit\CosmoteerRoleAudit.csproj'
$env:PATH = "$gameBinPath;$env:PATH"
dotnet run --project $projectPath -- $libraryPath $outputPath $gameBinPath
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
