from __future__ import annotations

import unittest

from app.complaint_mapping import (
    CHIEF_COMPLAINT_CODE_TO_ID,
    COMPLAINT_TO_PROCEDURE_GROUPS,
    MKIOSK_TO_COMPLAINTS,
    complaint_id_from_chief_complaint,
    complaints_from_mkiosk_flags,
    normalize_chief_complaint,
    required_procedure_groups_for_complaint,
)
from app.procedure_groups import PROCEDURE_GROUPS


class ComplaintMappingTests(unittest.TestCase):
    def test_complaint_id_from_chief_complaint_maps_known_aliases(self) -> None:
        for alias, expected_id in CHIEF_COMPLAINT_CODE_TO_ID.items():
            with self.subTest(alias=alias):
                self.assertEqual(complaint_id_from_chief_complaint(alias), expected_id)
                self.assertEqual(
                    complaint_id_from_chief_complaint(f" {alias.upper()} "),
                    expected_id,
                )

    def test_complaint_id_from_chief_complaint_returns_none_for_unknown_or_empty(
        self,
    ) -> None:
        for value in ("", "   ", "unknown"):
            with self.subTest(value=value):
                self.assertIsNone(complaint_id_from_chief_complaint(value))

    def test_normalize_chief_complaint_maps_clinical_aliases(self) -> None:
        cases = [
            ("acute focal weakness", "neuro", 3),
            ("focal weakness", "neuro", 3),
            ("stroke_like", "neuro", 3),
            ("한쪽 마비", "neuro", 3),
            ("숨을 못 쉼", "dyspnea", 2),
        ]

        for value, expected_code, expected_id in cases:
            with self.subTest(value=value):
                self.assertEqual(normalize_chief_complaint(value), expected_code)
                self.assertEqual(
                    complaint_id_from_chief_complaint(value),
                    expected_id,
                )

    def test_normalize_chief_complaint_returns_none_for_unknown_label(self) -> None:
        self.assertIsNone(normalize_chief_complaint("unknown label"))
        self.assertIsNone(complaint_id_from_chief_complaint("unknown label"))

    def test_normalize_chief_complaint_maps_back_and_flank_pain_aliases(
        self,
    ) -> None:
        cases = [
            ("low back pain", "trauma", 7),
            ("back pain", "trauma", 7),
            ("lower back pain", "trauma", 7),
            ("lumbar pain", "trauma", 7),
            ("lumbago", "trauma", 7),
            ("back injury", "trauma", 7),
            ("허리 통증", "trauma", 7),
            ("요통", "trauma", 7),
            ("flank pain", "abdominal", 4),
            ("renal colic", "abdominal", 4),
            ("kidney stone", "abdominal", 4),
            ("옆구리 통증", "abdominal", 4),
        ]

        for value, expected_code, expected_id in cases:
            with self.subTest(value=value):
                self.assertEqual(normalize_chief_complaint(value), expected_code)
                self.assertEqual(
                    complaint_id_from_chief_complaint(value),
                    expected_id,
                )

    def test_required_procedure_groups_for_complaint_returns_valid_group_ids(
        self,
    ) -> None:
        valid_group_ids = set(PROCEDURE_GROUPS)

        for complaint_id in COMPLAINT_TO_PROCEDURE_GROUPS:
            with self.subTest(complaint_id=complaint_id):
                groups = required_procedure_groups_for_complaint(complaint_id)
                self.assertEqual(set(groups) - valid_group_ids, set())

    def test_required_procedure_groups_for_complaint_returns_empty_for_unknown(
        self,
    ) -> None:
        self.assertEqual(required_procedure_groups_for_complaint(0), [])
        self.assertEqual(required_procedure_groups_for_complaint(999), [])

    def test_complaints_from_mkiosk_flags_accepts_y_values(self) -> None:
        for value in ("Y", "Y1", " y "):
            with self.subTest(value=value):
                self.assertEqual(
                    complaints_from_mkiosk_flags({"MKioskTy1": value}),
                    MKIOSK_TO_COMPLAINTS["MKioskTy1"],
                )

    def test_complaints_from_mkiosk_flags_ignores_n_empty_none_and_unknown_values(
        self,
    ) -> None:
        for value in ("N", "N1", "", "   ", None, "unknown"):
            with self.subTest(value=value):
                self.assertEqual(
                    complaints_from_mkiosk_flags({"MKioskTy1": value}),
                    set(),
                )

    def test_complaints_from_mkiosk_flags_ignores_unknown_enabled_key(self) -> None:
        self.assertEqual(complaints_from_mkiosk_flags({"MKioskTy999": "Y"}), set())


if __name__ == "__main__":
    unittest.main()
