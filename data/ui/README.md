# UI priority map

`ingame_ui_priority_settings.csv` is a curated reference table mapping serialized part/component keys to visible UI categories and actions, visibility status, built-in fallback values, and provenance. Its `source_file` entries are relative to the installed game Data directory so the map is not tied to a local installation path.

The map's UI visibility, labels, and categories require review against the game interface. `tools/ui-map/resolve_installed_rule_defaults.py` can assist with component default values from installed rule files, but it does not infer UI presentation. Review proposed changes manually, especially after game updates.
