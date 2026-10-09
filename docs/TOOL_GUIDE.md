# Tool guide

This repository contains several tools with different scopes. The audit and parsing components are intended to be reusable; the dated comparison builder and ship writers have narrower, source-defined assumptions.

## Read-only audit

`CosmoteerRoleAudit` loads the game assemblies from a supplied installation directory and scans a supplied saved-ship library. It writes ship/profile indexes, normalized role records, and relevant rule data to an output directory. It does not write to the source ships. The PowerShell wrapper supplies the game assembly directory and chooses a local output folder.

## Role profile parsing

`role_profile_parser.py` reads normalized role records and exposes role metadata and exact serialized priority keys/values. It is used by the comparison pipeline and covered by a small fixture test.

## UI priority map and default resolver

`data/ui/ingame_ui_priority_settings.csv` maps serialized part/component keys to UI categories, action labels, visibility status, and default-value provenance. Source paths in the CSV are relative to the installed game Data directory.

`resolve_installed_rule_defaults.py` can refresh component defaults from a supplied Data directory. It cannot infer what is visible in the UI or assign UI labels/categories; its output is a proposal that requires review.

## Comparison and workbook pipeline

The Python builder under `tools/role-analysis/snapshots/` combines an audit report with a reviewed UI map, applies comparison definitions, and emits structured JSON with visible and internal keys separated. The JavaScript exporter turns that JSON into a workbook and previews.

Each dated builder is a frozen recipe for a particular dataset and set of analysis decisions. Candidate rosters, role names, corrections, expected counts, and validations may be encoded directly in that recipe. Do not assume it is a universal comparator: for a new dataset, create a new dated recipe or extract configurable logic, then review its assumptions and tests. The workbook exporter expects the builder's JSON schema.

## Guarded ship writer

`CosmoteerRoleWriter` reads a local JSON config, an analysis JSON file, and two target ship files. It stages the output, verifies the expected role structure and visible priority keys, preserves internal entries and non-role ship data, checks hashes, writes reports, makes backups, and only replaces targets when passed `--write`.

This implementation is intentionally schema-specific: the expected role labels, visible-key count, and role corrections are fixed in source. The example config uses environment-variable placeholders for the two target ships. Review and replace those values before use; do not assume the writer supports arbitrary role sets or templates.

`CrewTestWriter` is an even narrower serialization probe. It expects a specific source design and changes one known priority before creating a new target. It is not a general ship editor; inspect the source before reusing or adapting it.

## Local workspace

Runtime data belongs outside the source checkout. `Initialize-LocalWorkspace.ps1` creates the local directory structure and sets `COSMOTEER_UTILS_HOME`; it rejects a root inside the repository. Game paths are supplied separately as `COSMOTEER_GAME_BIN`, `COSMOTEER_GAME_DATA`, and `COSMOTEER_SAVED_SHIPS`. See [workflow](WORKFLOW.md) for commands. Keep tests and assumptions current when extending a tool.
