import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools" / "role-analysis"))
from role_profile_parser import parse_profile


SAMPLE = '''(ChildList) [1 children]
\t[0]: (ChildMap) [3 children]
\t\t"AssignmentPriority": (Data) Int32:5
\t\t"AutoFillFromLower": (Data) Bool:False
\t\t"Name": (Data) String:"Unasigned"
\t\t"Priorities": (ChildList) [1 children]
\t\t\t[0]: (ChildMap) [2 children]
\t\t\t\t"Key": (ChildMap) [2 children]
\t\t\t\t\t"ComponentID": (Data) String:"PartCrew"
\t\t\t\t\t"PartID": (Data) String:"cosmoteer.control_room_small"
\t\t\t\t"Value": (Data) Int32:0
'''


class ParseProfileTests(unittest.TestCase):
    def test_reads_role_metadata_and_exact_priority_key(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent) as directory:
            path = Path(directory) / "sample.roles.txt"
            path.write_text(SAMPLE, encoding="utf-8")
            roles = parse_profile(path)

        self.assertEqual(len(roles), 1)
        self.assertEqual(roles[0]["name"], "Unasigned")
        self.assertEqual(roles[0]["assignment"], 5)
        self.assertFalse(roles[0]["autofill"])
        self.assertEqual(
            roles[0]["priorities"],
            [("cosmoteer.control_room_small", "PartCrew", 0)],
        )


if __name__ == "__main__":
    unittest.main()
