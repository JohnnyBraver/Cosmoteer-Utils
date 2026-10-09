import csv
import unittest
from pathlib import Path


MAP_PATH = Path(__file__).resolve().parents[1] / "data" / "ui" / "ingame_ui_priority_settings.csv"


class UiPriorityMapTests(unittest.TestCase):
    def test_reviewed_snapshot_has_complete_visible_defaults(self):
        with MAP_PATH.open(encoding="utf-8-sig", newline="") as source:
            rows = list(csv.DictReader(source))
        visible = [row for row in rows if row["ui_visibility"] == "VISIBLE UI ACTION"]
        internal = [row for row in rows if row["ui_visibility"] == "INTERNAL / NOT UI-VERIFIABLE"]

        self.assertEqual(len(visible), 139)
        self.assertEqual(len(internal), 7)
        self.assertTrue(all(row["builtin_default"].strip() for row in visible))
        self.assertTrue(all(row["category"] and row["action"] for row in visible))


if __name__ == "__main__":
    unittest.main()
