# Cosmoteer Utils

Utilities for reading and analyzing Cosmoteer ship-role data, mapping serialized priorities to visible UI actions, and performing narrowly scoped, guarded role-priority writes.

## Repository contents

- `src/CosmoteerRoleAudit` — read-only ship-library scanner using the installed game assemblies.
- `tools/role-analysis` — role-profile parser and a dated comparison/workbook pipeline.
- `tools/role-audit` — PowerShell entry point for the scanner.
- `tools/ui-map` and `data/ui` — built-in-default resolver and curated UI/action reference map.
- `tools/ship-tools` — guarded role writer and a narrow serialization probe.
- `tests` — small parser and UI-map regression tests.
- `docs` — tool scope, operation, and maintenance guidance.

## Local data and safety

Keep ship libraries, audit reports, generated comparison files, workbooks, writer configuration, and backups outside the source repository. Set `COSMOTEER_UTILS_HOME` or use the initializer; its default is `%LOCALAPPDATA%/Cosmoteer-Utils`. Game installation and saved-ship locations are also supplied externally through environment variables, not committed paths.

The scanner reads ship files and exports role data, not ship layouts. The writer defaults to dry-run and only writes with explicit `--write`; its role schema and priority rules are currently fixed in source, so verify compatibility before using it with a different design format. See the [tool guide](docs/TOOL_GUIDE.md) and [workflow](docs/WORKFLOW.md).
