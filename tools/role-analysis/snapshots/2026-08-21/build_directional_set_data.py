"""Build profile-by-profile directional crew-set comparison data."""
import csv
import hashlib
import json
import sys
import argparse
import os
from collections import Counter, defaultdict
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]
LOCAL_BASE = os.environ.get("LOCALAPPDATA") or str(Path.home() / "AppData" / "Local")
LOCAL_ROOT = Path(os.environ.get("COSMOTEER_UTILS_HOME") or Path(LOCAL_BASE) / "Cosmoteer-Utils").resolve()
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--report-dir", type=Path, default=LOCAL_ROOT / "audit" / "role-audit",
                    help="Folder produced by CosmoteerRoleAudit (ships.csv and *.roles.txt).")
parser.add_argument("--ui-map", type=Path,
                    default=REPO_ROOT / "data" / "ui" / "ingame_ui_priority_settings.csv",
                    help="Curated visible/internal UI priority map CSV.")
parser.add_argument("--output", type=Path,
                    default=LOCAL_ROOT / "analysis" / "directional_set_comparison.json",
                    help="Output JSON path.")
args = parser.parse_args()
REPORT = args.report_dir.resolve()
UI_CSV = args.ui_map.resolve()
OUT = args.output.resolve()
OUT.parent.mkdir(parents=True, exist_ok=True)

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from role_profile_parser import parse_profile

UNASSIGNED = "Unasigned"
SPECIAL = "Special asigment"
ASTRO = "Astrophobic Cargo Crew"
COMBAT_ROLES = ["Engine(r)", "Operator", "Defender", "Defender - PD focus", "Loader", "Distributor"]
CIVILIAN_ROLES = ["Engine(r)", "Operator", "Distributor"]
ALL_ROLES = [UNASSIGNED, SPECIAL, "Engine(r)", "Operator", "Defender", "Defender - PD focus", ASTRO, "Loader", "Distributor"]
ROLE_PREFIX = {
    UNASSIGNED: "U", SPECIAL: "S", "Engine(r)": "E", "Operator": "O",
    "Defender": "D", "Defender - PD focus": "PD", ASTRO: "A",
    "Loader": "L", "Distributor": "DIST",
}
UI_ORDER = [
    "Energy Weapons", "Projectile Weapons", "Defenses", "Thrusters", "Ship Control",
    "Crew", "Power", "Production", "Storage", "Heat Management", "Utilities",
]
DIRECTION_ORDER = {"HIGHER": 0, "LOWER": 1, "OFF": 2, "MATCH": 3, "UNRESOLVED": 4}
ACTIVE_CANDIDATE_ID = "SET-5D66DC86"
RETAINED_VARIANTS = {
    UNASSIGNED: "U1",
    SPECIAL: "S1",
    "Engine(r)": "E4",
    "Operator": "O6",
    "Defender": "D2",
    "Defender - PD focus": "PD1",
    ASTRO: "A3",
    "Loader": "L6",
    "Distributor": "DIST1",
}
SUPERSEDED_ROLES = {"Engine(r)", "Loader", "Distributor", ASTRO}


def norm(value):
    return str(value or "").strip().lower()


def role_map(role):
    return {(part, component): value for part, component, value in role["priorities"]}


def role_fingerprint(role):
    payload = {
        "assignment": role["assignment"],
        "autofill": bool(role["autofill"]),
        "priorities": sorted(role["priorities"]),
    }
    raw = json.dumps(payload, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]


def to_int(value):
    if value in ("", None):
        return None
    return int(value)


def direction(baseline, target):
    if baseline is None or target is None:
        return "UNRESOLVED"
    if baseline == target:
        return "MATCH"
    if target == 0 and baseline > 0:
        return "OFF"
    return "HIGHER" if target > baseline else "LOWER"


def direction_label(value):
    return "OFF (LOWER)" if value == "OFF" else value


def display_value(value):
    return "?" if value is None else str(value)


def value_range(values):
    nums = sorted({value for value in values if value is not None})
    if not nums:
        return "?"
    if len(nums) == 1:
        return str(nums[0])
    return f"{nums[0]}-{nums[-1]}"


def compact_parts(parts, limit=5):
    values = sorted({p for p in parts if p})
    if len(values) <= limit:
        return ", ".join(values)
    return ", ".join(values[:limit]) + f", +{len(values) - limit} more"


ships = list(csv.DictReader((REPORT / "ships.csv").open(encoding="utf-8-sig", newline="")))
profile_ids = {row["role_profile"] for row in ships if row.get("role_profile")}
profiles = {profile_id: parse_profile(REPORT / f"{profile_id}.roles.txt") for profile_id in profile_ids}
ships_by_profile = defaultdict(list)
for row in ships:
    if row.get("role_profile"):
        ships_by_profile[row["role_profile"]].append(row)

required = {norm(name) for name in ALL_ROLES}
candidates = []
profile_audit = []
for profile_id, roles in profiles.items():
    by_name = {norm(role["name"]): role for role in roles}
    cargo_present = norm("Cargo crew") in by_name
    special_roles = [role for role in roles if norm(role["name"]).startswith(("special asig", "special assig"))]
    special_non10 = any(value != 10 for role in special_roles for _, _, value in role["priorities"])
    missing_roles = sorted(name for name in ALL_ROLES if norm(name) not in by_name)
    complete = not missing_roles
    rows = ships_by_profile[profile_id]
    oldest = min(row["modified_utc"] for row in rows)
    newest = max(row["modified_utc"] for row in rows)
    reasons = []
    if cargo_present:
        reasons.append("CARGO CREW")
    if special_non10:
        reasons.append("SPECIAL NON-10")
    if not complete:
        reasons.append("INCOMPLETE: " + ", ".join(missing_roles))
    selectable = not reasons
    audit_row = {
        "candidate_id": f"SET-{profile_id[:8].upper()}" if selectable else "",
        "profile_hash": profile_id,
        "selectable": selectable,
        "exclusion_reason": "; ".join(reasons),
        "ship_count": len(rows),
        "oldest_modified_utc": oldest,
        "newest_modified_utc": newest,
        "role_count": len(roles),
        "role_names": " | ".join(role["name"] for role in roles),
        "example_ships": " | ".join(sorted(row["relative_path"] for row in rows)[:5]),
    }
    profile_audit.append(audit_row)
    if selectable:
        candidates.append({
            **audit_row,
            "roles": by_name,
            "ship_paths": sorted(row["relative_path"] for row in rows),
        })

candidates.sort(key=lambda row: (row["newest_modified_utc"], row["profile_hash"]), reverse=True)

ui_rows = []
seen_ui = set()
with UI_CSV.open(encoding="utf-8-sig", newline="") as stream:
    for raw in csv.DictReader(stream):
        identity = (
            raw["category"], raw["part_id"], raw["component_id"], raw["action"],
            raw["ui_visibility"],
        )
        if identity in seen_ui:
            continue
        seen_ui.add(identity)
        ui_rows.append({
            "ui_category": raw["category"],
            "ui_action": raw["action"],
            "part_id": raw["part_id"],
            "part_name": raw["part_name"],
            "component_id": raw["component_id"],
            "ui_visibility": raw["ui_visibility"],
            "builtin_default": to_int(raw["builtin_default"]),
            "default_source": raw["default_source"],
            "resolution": raw["resolution"],
            "source_file": raw["source_file"],
        })

visible_ui = [row for row in ui_rows if row["ui_visibility"] == "VISIBLE UI ACTION"]
internal_ui = [row for row in ui_rows if row["ui_visibility"] != "VISIBLE UI ACTION"]
category_index = {name: index for index, name in enumerate(UI_ORDER)}

# Role-version catalog and per-candidate fingerprint.
variant_usage = defaultdict(lambda: defaultdict(lambda: {
    "profile_ids": set(), "candidate_ids": set(), "ship_count": 0,
    "first_seen": None, "last_seen": None, "role": None,
}))
for candidate in candidates:
    for role_name in ALL_ROLES:
        role = candidate["roles"][norm(role_name)]
        fp = role_fingerprint(role)
        item = variant_usage[role_name][fp]
        item["profile_ids"].add(candidate["profile_hash"])
        item["candidate_ids"].add(candidate["candidate_id"])
        item["ship_count"] += candidate["ship_count"]
        item["first_seen"] = min(x for x in [item["first_seen"], candidate["oldest_modified_utc"]] if x)
        item["last_seen"] = max(x for x in [item["last_seen"], candidate["newest_modified_utc"]] if x)
        item["role"] = role

variant_labels = {}
variant_catalog = []
for role_name in ALL_ROLES:
    ordered = sorted(
        variant_usage[role_name].items(),
        key=lambda pair: (pair[1]["first_seen"], pair[0]),
    )
    for index, (fp, item) in enumerate(ordered, 1):
        label = f"{ROLE_PREFIX[role_name]}{index}"
        variant_labels[(role_name, fp)] = label
        role = item["role"]
        variant_catalog.append({
            "role_name": role_name,
            "variant_id": label,
            "variant_hash": fp,
            "candidate_count": len(item["candidate_ids"]),
            "ship_count": item["ship_count"],
            "first_seen": item["first_seen"],
            "last_seen": item["last_seen"],
            "assignment_priority": role["assignment"],
            "autofill": bool(role["autofill"]),
            "explicit_priority_entries": len(role["priorities"]),
            "candidate_ids": ", ".join(sorted(item["candidate_ids"])),
        })

for candidate in candidates:
    fingerprint = {}
    for role_name in ALL_ROLES:
        fp = role_fingerprint(candidate["roles"][norm(role_name)])
        fingerprint[role_name] = variant_labels[(role_name, fp)]
    candidate["role_versions"] = fingerprint

active_candidate = next(
    candidate for candidate in candidates if candidate["candidate_id"] == ACTIVE_CANDIDATE_ID
)
assert active_candidate["role_versions"] == RETAINED_VARIANTS, active_candidate["role_versions"]
active_candidates = [active_candidate]

for row in variant_catalog:
    retained = RETAINED_VARIANTS[row["role_name"]]
    if row["variant_id"] == retained:
        row["status"] = "RETAINED"
        row["status_reason"] = "Used by the provisional active crew set."
    elif row["role_name"] in SUPERSEDED_ROLES:
        row["status"] = "REJECTED AS SUPERSEDED"
        row["status_reason"] = f"Inactive in favor of {retained}; explicit values remain available as donor evidence."
    else:
        row["status"] = "INACTIVE WITH REJECTED CREW SET"
        row["status_reason"] = "Not independently rejected; no surviving complete crew set uses this variant."

variant_roles = {}
for candidate in candidates:
    for role_name in ALL_ROLES:
        variant_id = candidate["role_versions"][role_name]
        variant_roles.setdefault((role_name, variant_id), candidate["roles"][norm(role_name)])


def resolve_role_value(role, entry):
    values = role_map(role)
    key = (entry["part_id"], entry["component_id"])
    if key in values:
        return values[key], "EXPLICIT"
    if entry["builtin_default"] is not None:
        return entry["builtin_default"], "FALLBACK"
    return None, "UNRESOLVED"


correction_specs = [
    ("Loader", "cosmoteer.thruster_rocket_nozzle", "PartCrew", 0,
     "Confirmed intended suppression carried forward from older Loader variants.",
     "Retained L6 falls back on an M.R.T. job; older explicit zero is confirmed intended."),
    ("Distributor", "cosmoteer.resonance_beam_turret", "PartCrew", 0,
     "Match Distributor's explicit no-operation rule for established energy weapons.",
     "Newer energy weapon falls back instead of receiving the established -7 operation offset."),
    ("Distributor", "cosmoteer.chaingun", "PartCrew", 0,
     "Match Distributor's explicit no-operation rule for established projectile weapons.",
     "Newer projectile weapon falls back instead of receiving the established -7 operation offset."),
    ("Distributor", "cosmoteer.resonance_beam_turret", "BatteryConsumer", 4,
     "Apply the ordinary energy-weapon battery offset of default 5 to role value 4.",
     "Newer energy weapon is missing the family's established -1 battery-supply offset."),
    ("Distributor", "cosmoteer.thermal_amplification_pump", "BatteryConsumer", 4,
     "Apply the ordinary energy-weapon battery offset of default 5 to role value 4.",
     "Newer lance support module is missing the family's established -1 battery-supply offset."),
    ("Distributor", "cosmoteer.thermal_dilation_pump", "BatteryConsumer", 4,
     "Apply the ordinary energy-weapon battery offset of default 5 to role value 4.",
     "Newer lance support module is missing the family's established -1 battery-supply offset."),
    ("Distributor", "cosmoteer.missile_launcher", "ThermalMissileStorage", 8,
     "Match the +3 delivery offset used for the other missile and mine payloads.",
     "Newer thermal-canister payload falls back to 5 while comparable payloads are explicit 8."),
    ("Distributor", "cosmoteer.chaingun", "AmmoConsumerLeft", 5,
     "Keep conventional ammunition supply at the default value used by other cannons.",
     "Fallback checked against the established conventional-ammunition family; no change required."),
    ("Distributor", "cosmoteer.chaingun_magazine", "AmmoConsumer", 5,
     "Keep conventional ammunition supply at the default value used by other cannons.",
     "Fallback checked against the established conventional-ammunition family; no change required."),
]
ui_by_key = {(row["part_id"], row["component_id"]): row for row in visible_ui}
proposed_corrections = []
for role_name, part_id, component_id, proposed_value, family_rule, coverage_note in correction_specs:
    entry = ui_by_key[(part_id, component_id)]
    role = active_candidate["roles"][norm(role_name)]
    retained_value, source_status = resolve_role_value(role, entry)
    baseline_role = active_candidate["roles"][norm(UNASSIGNED)]
    baseline_value, baseline_status = resolve_role_value(baseline_role, entry)
    proposed_corrections.append({
        "candidate_id": ACTIVE_CANDIDATE_ID,
        "role_name": role_name,
        "retained_variant": RETAINED_VARIANTS[role_name],
        "ui_category": entry["ui_category"],
        "ui_action": entry["ui_action"],
        "part_name": entry["part_name"],
        "part_id": part_id,
        "component_id": component_id,
        "builtin_default": entry["builtin_default"],
        "baseline_value": baseline_value,
        "baseline_source": baseline_status,
        "source_status": source_status,
        "retained_value": retained_value,
        "proposed_value": proposed_value,
        "proposed_direction": direction(baseline_value, proposed_value),
        "decision_state": "CONFIRMED CHANGE" if retained_value != proposed_value else "CONFIRMED KEEP",
        "inferred_new_part_coverage": coverage_note,
        "family_rule": family_rule,
    })

transition_entries = []
seen_transition_keys = set()
for entry in visible_ui:
    key = (entry["part_id"], entry["component_id"])
    if key not in seen_transition_keys:
        seen_transition_keys.add(key)
        transition_entries.append(entry)

transition_rows = []
for role_name in sorted(SUPERSEDED_ROLES):
    retained_variant = RETAINED_VARIANTS[role_name]
    retained_role = variant_roles[(role_name, retained_variant)]
    source_variants = sorted(
        row["variant_id"] for row in variant_catalog
        if row["role_name"] == role_name and row["variant_id"] != retained_variant
    )
    for source_variant in source_variants:
        source_role = variant_roles[(role_name, source_variant)]
        for entry in transition_entries:
            source_value, source_status = resolve_role_value(source_role, entry)
            retained_value, retained_status = resolve_role_value(retained_role, entry)
            if source_value == retained_value and source_status == retained_status:
                continue
            transition_class = f"{source_status} → {retained_status}"
            interpretation = {
                "EXPLICIT → EXPLICIT": "GENUINE VERSION CHANGE",
                "FALLBACK → EXPLICIT": "NEW COVERAGE / SPECIALIZATION",
                "EXPLICIT → FALLBACK": "POTENTIALLY LOST OVERRIDE",
                "FALLBACK → FALLBACK": "NO ROLE-SERIALIZATION CHANGE",
            }.get(transition_class, "REVIEW")
            decision_state = "AUDIT ONLY"
            if role_name == "Engine(r)" and source_variant == "E3" and transition_class == "EXPLICIT → FALLBACK" and source_value != retained_value:
                decision_state = "DONOR REVIEW"
            transition_rows.append({
                "role_name": role_name,
                "source_variant": source_variant,
                "retained_variant": retained_variant,
                "ui_category": entry["ui_category"],
                "ui_action": entry["ui_action"],
                "part_name": entry["part_name"],
                "part_id": entry["part_id"],
                "component_id": entry["component_id"],
                "builtin_default": entry["builtin_default"],
                "source_value": source_value,
                "source_status": source_status,
                "retained_value": retained_value,
                "retained_status": retained_status,
                "transition_class": transition_class,
                "value_changed": source_value != retained_value,
                "interpretation": interpretation,
                "decision_state": decision_state,
            })

donor_evidence = [row for row in transition_rows if row["decision_state"] == "DONOR REVIEW"]


def exact_rows_for(context, baseline_name, target_names, entries):
    output = []
    for candidate in candidates:
        baseline_role = candidate["roles"][norm(baseline_name)]
        baseline_map = role_map(baseline_role)
        for target_name in target_names:
            target_role = candidate["roles"][norm(target_name)]
            target_map = role_map(target_role)
            for entry in entries:
                key = (entry["part_id"], entry["component_id"])
                if key in baseline_map:
                    baseline_value = baseline_map[key]
                    baseline_source = "EXPLICIT"
                else:
                    baseline_value = entry["builtin_default"]
                    baseline_source = "BUILT-IN FALLBACK" if baseline_value is not None else "UNRESOLVED"
                if key in target_map:
                    target_value = target_map[key]
                    target_source = "EXPLICIT"
                else:
                    target_value = entry["builtin_default"]
                    target_source = "BUILT-IN FALLBACK" if target_value is not None else "UNRESOLVED"
                result = direction(baseline_value, target_value)
                output.append({
                    "candidate_id": candidate["candidate_id"],
                    "profile_hash": candidate["profile_hash"],
                    "context": context,
                    "baseline_role": baseline_name,
                    "target_role": target_name,
                    **entry,
                    "baseline_value": baseline_value,
                    "target_value": target_value,
                    "baseline_source": baseline_source,
                    "target_source": target_source,
                    "direction": result,
                    "delta": target_value - baseline_value if baseline_value is not None and target_value is not None else None,
                })
    return output


visible_exact = (
    exact_rows_for("COMBAT", UNASSIGNED, COMBAT_ROLES, visible_ui)
    + exact_rows_for("CIVILIAN", ASTRO, CIVILIAN_ROLES, visible_ui)
)
internal_exact = (
    exact_rows_for("COMBAT", UNASSIGNED, COMBAT_ROLES, internal_ui)
    + exact_rows_for("CIVILIAN", ASTRO, CIVILIAN_ROLES, internal_ui)
)


def make_cell(rows):
    grouped = defaultdict(list)
    for row in rows:
        grouped[(row["baseline_value"], row["target_value"], row["direction"])].append(row)
    if len(grouped) == 1:
        baseline, target, result = next(iter(grouped))
        return f"{display_value(baseline)} -> {display_value(target)} {direction_label(result)}"
    directions = {key[2] for key in grouped}
    if len(directions) == 1:
        result = next(iter(directions))
        return (
            f"{value_range(row['baseline_value'] for row in rows)} -> "
            f"{value_range(row['target_value'] for row in rows)} {direction_label(result)}"
        )
    lines = ["VARIED"]
    for (baseline, target, result), members in sorted(
        grouped.items(),
        key=lambda pair: (DIRECTION_ORDER.get(pair[0][2], 99), str(pair[0][0]), str(pair[0][1])),
    ):
        parts = compact_parts(member["part_name"] for member in members)
        lines.append(
            f"{display_value(baseline)} -> {display_value(target)} "
            f"{direction_label(result)}: {parts}"
        )
    return "\n".join(lines)


def build_matrix(context, target_roles, matrix_candidates):
    source = [row for row in visible_exact if row["context"] == context]
    row_lookup = defaultdict(list)
    for row in source:
        row_lookup[(
            row["target_role"], row["ui_category"], row["ui_action"], row["candidate_id"]
        )].append(row)
    action_parts = defaultdict(set)
    for row in visible_ui:
        action_parts[(row["ui_category"], row["ui_action"])].add(row["part_name"])
    actions = sorted(
        action_parts,
        key=lambda key: (category_index.get(key[0], 999), key[0], key[1]),
    )
    matrix = []
    exceptions = []
    for target_role in target_roles:
        for ui_category, ui_action in actions:
            cells = {}
            for candidate in matrix_candidates:
                rows = row_lookup[(target_role, ui_category, ui_action, candidate["candidate_id"])]
                cells[candidate["candidate_id"]] = make_cell(rows)
                pair_count = len({
                    (row["baseline_value"], row["target_value"], row["direction"])
                    for row in rows
                })
                if pair_count > 1:
                    for row in rows:
                        exceptions.append({
                            "candidate_id": row["candidate_id"],
                            "profile_hash": row["profile_hash"],
                            "context": context,
                            "baseline_role": row["baseline_role"],
                            "target_role": target_role,
                            "ui_category": ui_category,
                            "ui_action": ui_action,
                            "part_name": row["part_name"],
                            "part_id": row["part_id"],
                            "component_id": row["component_id"],
                            "baseline_value": row["baseline_value"],
                            "target_value": row["target_value"],
                            "direction": row["direction"],
                            "baseline_source": row["baseline_source"],
                            "target_source": row["target_source"],
                            "builtin_default": row["builtin_default"],
                        })
            matrix.append({
                "target_role": target_role,
                "ui_category": ui_category,
                "ui_action": ui_action,
                "parts": ", ".join(sorted(action_parts[(ui_category, ui_action)])),
                "cells": cells,
            })
    return matrix, exceptions


combat_matrix, combat_exceptions = build_matrix("COMBAT", COMBAT_ROLES, active_candidates)
civilian_matrix, civilian_exceptions = build_matrix("CIVILIAN", CIVILIAN_ROLES, active_candidates)
exceptions = combat_exceptions + civilian_exceptions

counts = defaultdict(Counter)
for row in visible_exact:
    counts[(row["candidate_id"], row["context"])][row["direction"]] += 1

all_candidate_rows = []
for candidate in candidates:
    mismatch_reasons = [
        f"{role_name} {candidate['role_versions'][role_name]} superseded by {RETAINED_VARIANTS[role_name]}"
        for role_name in sorted(SUPERSEDED_ROLES)
        if candidate["role_versions"][role_name] != RETAINED_VARIANTS[role_name]
    ]
    inactive_versions = [
        f"{role_name} {candidate['role_versions'][role_name]}"
        for role_name in ("Operator", "Defender")
        if candidate["role_versions"][role_name] != RETAINED_VARIANTS[role_name]
    ]
    is_active = candidate["candidate_id"] == ACTIVE_CANDIDATE_ID
    row = {
        "candidate_id": candidate["candidate_id"],
        "profile_hash": candidate["profile_hash"],
        "decision": "Shortlist" if is_active else "Reject",
        "active_status": "PROVISIONAL WINNER" if is_active else "EXCLUDED",
        "exclusion_reason": "" if is_active else "; ".join(mismatch_reasons or ["Not selected after whole-set pruning"]),
        "inactive_role_note": "" if is_active else (
            ", ".join(inactive_versions) + " inactive with rejected set; not independently rejected"
            if inactive_versions else ""
        ),
        "ship_count": candidate["ship_count"],
        "oldest_modified_utc": candidate["oldest_modified_utc"],
        "newest_modified_utc": candidate["newest_modified_utc"],
        "representative_ship": candidate["ship_paths"][0],
        "example_ships": " | ".join(candidate["ship_paths"][:5]),
        "role_fingerprint": " | ".join(
            f"{ROLE_PREFIX[name]}={candidate['role_versions'][name]}" for name in ALL_ROLES
        ),
        "role_versions": candidate["role_versions"],
    }
    all_candidate_rows.append(row)

candidate_rows = [row for row in all_candidate_rows if row["candidate_id"] == ACTIVE_CANDIDATE_ID]
pruned_candidate_rows = [row for row in all_candidate_rows if row["candidate_id"] != ACTIVE_CANDIDATE_ID]

role_version_counts = Counter(row["role_name"] for row in variant_catalog)
expected_version_counts = {
    UNASSIGNED: 1, SPECIAL: 1, "Engine(r)": 4, "Operator": 6, "Defender": 2,
    "Defender - PD focus": 1, ASTRO: 3, "Loader": 6, "Distributor": 2,
}

assert len(all_candidate_rows) == 14, len(all_candidate_rows)
assert sum(row["ship_count"] for row in all_candidate_rows) == 96
assert len(candidate_rows) == 1 and candidate_rows[0]["candidate_id"] == ACTIVE_CANDIDATE_ID
assert len(pruned_candidate_rows) == 13
assert sum(row["decision_state"] == "CONFIRMED CHANGE" for row in proposed_corrections) == 7
assert sum(row["decision_state"] == "CONFIRMED KEEP" for row in proposed_corrections) == 2
assert len(donor_evidence) == 10, len(donor_evidence)
assert role_version_counts == Counter(expected_version_counts), role_version_counts
assert not [row for row in visible_exact if row["direction"] == "UNRESOLVED"]
assert any(
    "2x819 TRL 1.01.ship.png" in candidate["ship_paths"]
    for candidate in candidates
)

payload = {
    "meta": {
        "decoded_ship_count": len(ships),
        "source_profile_count": len(profiles),
        "candidate_profile_count": len(all_candidate_rows),
        "candidate_ship_count": sum(row["ship_count"] for row in all_candidate_rows),
        "active_candidate_count": len(candidate_rows),
        "pruned_candidate_count": len(pruned_candidate_rows),
        "active_candidate_ship_count": sum(row["ship_count"] for row in candidate_rows),
        "confirmed_correction_count": sum(row["decision_state"] == "CONFIRMED CHANGE" for row in proposed_corrections),
        "confirmed_keep_count": sum(row["decision_state"] == "CONFIRMED KEEP" for row in proposed_corrections),
        "donor_review_count": len(donor_evidence),
        "excluded_profile_count": sum(not row["selectable"] for row in profile_audit),
        "visible_ui_entries": len(visible_ui),
        "internal_ui_entries": len(internal_ui),
        "combat_roles": COMBAT_ROLES,
        "civilian_roles": CIVILIAN_ROLES,
        "all_roles": ALL_ROLES,
        "combat_matrix_rows": len(combat_matrix),
        "civilian_matrix_rows": len(civilian_matrix),
        "visible_exact_rows": len(visible_exact),
        "internal_exact_rows": len(internal_exact),
        "exception_rows": len(exceptions),
        "fallback_rule": "An omitted serialized value uses the installed game's built-in UI default.",
        "direction_rule": "HIGHER and LOWER are numeric direction only; MATCH is equal; OFF is target zero from a positive baseline.",
    },
    "candidates": candidate_rows,
    "all_candidates": all_candidate_rows,
    "pruned_candidates": pruned_candidate_rows,
    "variant_catalog": variant_catalog,
    "variant_transitions": transition_rows,
    "proposed_corrections": proposed_corrections,
    "donor_evidence": donor_evidence,
    "role_version_counts": dict(role_version_counts),
    "combat_matrix": combat_matrix,
    "civilian_matrix": civilian_matrix,
    "exceptions": exceptions,
    "visible_exact": visible_exact,
    "internal_exact": internal_exact,
    "priority_map": ui_rows,
    "profile_audit": sorted(profile_audit, key=lambda row: (not row["selectable"], row["newest_modified_utc"]), reverse=False),
}
OUT.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
print(
    "Directional data:",
    len(candidate_rows), "active /", len(all_candidate_rows), "total candidates;",
    len(combat_matrix), "combat rows;",
    len(civilian_matrix), "civilian rows;",
    len(exceptions), "exceptions;",
    len(visible_exact), "visible audit rows;",
    len(internal_exact), "internal audit rows",
)
