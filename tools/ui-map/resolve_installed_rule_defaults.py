"""Resolve component defaults from installed rules with exact reference parsing."""
import csv
import argparse
import re
import os
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
LOCAL_BASE = os.environ.get("LOCALAPPDATA") or str(Path.home() / "AppData" / "Local")
LOCAL_ROOT = Path(os.environ.get("COSMOTEER_UTILS_HOME") or Path(LOCAL_BASE) / "Cosmoteer-Utils").resolve()
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--input-csv", type=Path,
                    default=REPO_ROOT / "data" / "ui" / "ingame_ui_priority_settings.csv",
                    help="Current UI priority map CSV.")
parser.add_argument("--game-data", type=Path, required=True, help="Cosmoteer Data folder containing ships/.")
parser.add_argument("--output-csv", type=Path,
                    default=LOCAL_ROOT / "analysis" / "ingame_ui_priority_settings.proposed.csv",
                    help="Write the resolved map to this separate file.")
args = parser.parse_args()
GAME = args.game_data.resolve()
input_csv = args.input_csv.resolve()
output_csv = args.output_csv.resolve()
if input_csv == output_csv:
    parser.error("--output-csv must differ from --input-csv; preserve the original map for review.")

constants = {}
for line in (GAME / "ships" / "priorities.rules").read_text(encoding="utf-8").splitlines():
    match = re.match(r"^([A-Za-z0-9_]+)\s*=\s*(-?\d+)", line.strip())
    if match: constants["PRIORITIES/" + match.group(1)] = int(match.group(2))
for match in re.finditer(r"(?m)^([A-Za-z0-9_]+)\s*=\s*(-?\d+)", (GAME / "ships" / "base_ship.rules").read_text(encoding="utf-8")):
    constants["base_ship:" + match.group(1)] = int(match.group(2))

source_defaults = {}
for path in (GAME / "ships" / "terran").rglob("*.rules"):
    text = path.read_text(encoding="utf-8", errors="ignore")
    part_match = re.search(r"(?m)^\s*ID\s*=\s*(cosmoteer\.[^\s/]+)", text)
    if not part_match: continue
    part_id, lines = part_match.group(1), text.splitlines()
    for index, line in enumerate(lines):
        reference = None
        match = re.search(r"DefaultPriority\s*=\s*&/PRIORITIES/([A-Za-z0-9_]+)", line)
        if match: reference = "PRIORITIES/" + match.group(1)
        match_base = re.search(r"DefaultPriority\s*=\s*&<[^>]*base_ship\.rules>/([A-Za-z0-9_]+)", line)
        if match_base: reference = "base_ship:" + match_base.group(1)
        if not reference or reference not in constants: continue
        component = ""
        for previous in range(index - 1, -1, -1):
            candidate = lines[previous]
            if re.match(r"^\t\t[A-Za-z][A-Za-z0-9_.]*\s*$", candidate):
                component = candidate.strip(); break
        if component:
            source_defaults[(part_id, component)] = (constants[reference], reference, "component-rule")

rows = list(csv.DictReader(input_csv.open(encoding="utf-8-sig", newline="")))
for row in rows:
    resolved = source_defaults.get((row["part_id"], row["component_id"]))
    if resolved:
        row["builtin_default"], row["default_source"], row["resolution"] = map(str, resolved)
output_csv.parent.mkdir(parents=True, exist_ok=True)
with output_csv.open("w", newline="", encoding="utf-8-sig") as stream:
    writer = csv.DictWriter(stream, fieldnames=list(rows[0].keys()))
    writer.writeheader(); writer.writerows(rows)
print("Installed component defaults found", len(source_defaults), "; wrote", output_csv)
