# Workflow

Examples below use PowerShell on Windows. They use variables for all machine-specific locations; do not put local game or ship-library paths in the repository.

## Initialize local paths

From the repository root:

```powershell
$REPO_ROOT = (Resolve-Path '.').Path
. (Join-Path $REPO_ROOT 'tools/Initialize-LocalWorkspace.ps1')
$LOCAL_ROOT = Initialize-CosmoteerUtilsLocalWorkspace -RepoRoot $REPO_ROOT
```

By default, `$LOCAL_ROOT` is `%LOCALAPPDATA%/Cosmoteer-Utils`. Set `$env:COSMOTEER_UTILS_HOME` before initialization or pass `-Root` to use another directory. The initializer refuses a location inside the repository.

Set the external paths for the installation and data you intend to inspect:

```powershell
$env:COSMOTEER_GAME_BIN = '<game-install>/Bin'
$env:COSMOTEER_GAME_DATA = '<game-install>/Data'
$env:COSMOTEER_SAVED_SHIPS = '<saved-ship-library>'
```

These values are examples/placeholders, not literal paths. They can be set for one shell session or managed in a private local environment file outside the repository.

## Scan a saved-ship library

```powershell
$AUDIT_DIR = Join-Path $LOCAL_ROOT 'audit/<audit-name>'
& (Join-Path $REPO_ROOT 'tools/role-audit/Run-Role-Audit.ps1') `
    -Library $env:COSMOTEER_SAVED_SHIPS `
    -GameBin $env:COSMOTEER_GAME_BIN `
    -Output $AUDIT_DIR
```

The scanner writes indexes, normalized role records, and relevant rule data to the output folder. It reads ships without changing them and does not export ship layouts.

## Refresh default values in the UI map

The resolver reads installed rule data and writes a proposed map separately from the reviewed source:

```powershell
python (Join-Path $REPO_ROOT 'tools/ui-map/resolve_installed_rule_defaults.py') `
    --input-csv (Join-Path $REPO_ROOT 'data/ui/ingame_ui_priority_settings.csv') `
    --game-data $env:COSMOTEER_GAME_DATA `
    --output-csv (Join-Path $LOCAL_ROOT 'analysis/ingame_ui_priority_settings.proposed.csv')
```

Review differences before promoting any map changes. The resolver does not discover UI visibility, categories, or action labels.

## Compare role sets and export a workbook

Comparison builders under `tools/role-analysis/snapshots/` are dated recipes. They combine an audit report and curated UI map according to definitions and validation rules in that recipe. Inspect those assumptions before using a builder on a different dataset; create a new dated recipe for materially different comparison rules. Replace `<snapshot-id>` below with the folder name for the recipe you have reviewed.

```powershell
$SNAPSHOT_DIR = Join-Path $REPO_ROOT 'tools/role-analysis/snapshots/<snapshot-id>'
$COMPARISON_JSON = Join-Path $LOCAL_ROOT 'analysis/<comparison-name>.json'
python (Join-Path $SNAPSHOT_DIR 'build_directional_set_data.py') `
    --report-dir $AUDIT_DIR `
    --ui-map (Join-Path $REPO_ROOT 'data/ui/ingame_ui_priority_settings.csv') `
    --output $COMPARISON_JSON
```

For JSON emitted by a compatible builder, the workbook exporter accepts explicit input and output paths:

```powershell
$WORKBOOK = Join-Path $LOCAL_ROOT 'reports/workbooks/<comparison-name>.xlsx'
$WORKBOOK_SCRIPT = Join-Path $SNAPSHOT_DIR 'build_directional_set_workbook.mjs'
node $WORKBOOK_SCRIPT `
    --data $COMPARISON_JSON `
    --output $WORKBOOK
```

The renderer also writes previews and inspection/error-scan files beside the workbook. It requires a Node runtime that can resolve `@oai/artifact-tool`; this package may only be present in the Codex workspace runtime.

## Run a guarded role write (advanced)

Copy `config/role-writer.example.json` to `$LOCAL_ROOT/config/role-writer.local.json`. Set `COSMOTEER_ROLE_TARGET_1` and `COSMOTEER_ROLE_TARGET_2` to the two intended ship files, then review the expanded paths and all other config values. The example writer has fixed role/schema assumptions; see [tool guide](TOOL_GUIDE.md).

Start with a dry run:

```powershell
$WRITER_CONFIG = Join-Path $LOCAL_ROOT 'config/role-writer.local.json'
dotnet run --project (Join-Path $REPO_ROOT 'tools/ship-tools/CosmoteerRoleWriter/CosmoteerRoleWriter.csproj') -- --config $WRITER_CONFIG
```

Only after checking the report, target files, and hashes should a write be enabled:

```powershell
dotnet run --project (Join-Path $REPO_ROOT 'tools/ship-tools/CosmoteerRoleWriter/CosmoteerRoleWriter.csproj') -- --config $WRITER_CONFIG --write
```

Never rely on the safeguards as a substitute for verifying the targets and retaining independent backups. The separate `CrewTestWriter` is a one-purpose serialization probe, not a general editor; inspect its source and arguments before using it.
