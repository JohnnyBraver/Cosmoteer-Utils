"""Parser for the normalized OBNode role text emitted by CosmoteerRoleAudit."""

import re
from pathlib import Path


def parse_profile(path: Path) -> list[dict]:
    """Return role records from one ``<profile-hash>.roles.txt`` export."""
    text = path.read_text(encoding="utf-8")
    starts = list(re.finditer(r"(?m)^\t\[\d+\]: \(ChildMap\)", text))
    roles = []
    for index, match in enumerate(starts):
        block = text[match.start(): starts[index + 1].start() if index + 1 < len(starts) else len(text)]
        name_match = re.search(r'(?m)^\t\t"Name":.*String:"([^"]*)"', block)
        if not name_match:
            continue
        assignment = re.search(r'"AssignmentPriority":.*Int32:(-?\d+)', block)
        autofill = re.search(r'"AutoFillFromLower":.*Bool:(True|False)', block)
        priorities = []
        entries = list(re.finditer(r"(?m)^\t\t\t\[\d+\]: \(ChildMap\)", block))
        for entry_index, entry in enumerate(entries):
            entry_block = block[
                entry.start(): entries[entry_index + 1].start()
                if entry_index + 1 < len(entries) else len(block)
            ]
            part = re.search(r'"PartID":.*String:"([^"]*)"', entry_block)
            component = re.search(r'"ComponentID":.*String:"([^"]*)"', entry_block)
            value = re.search(r'"Value":.*Int32:(-?\d+)', entry_block)
            if part and component and value:
                priorities.append((part.group(1), component.group(1), int(value.group(1))))
        roles.append({
            "name": name_match.group(1),
            "assignment": int(assignment.group(1)) if assignment else 5,
            "autofill": bool(autofill and autofill.group(1) == "True"),
            "priorities": priorities,
        })
    return roles
