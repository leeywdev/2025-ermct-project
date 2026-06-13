from __future__ import annotations

import unittest

from fastapi import HTTPException

from app.main import _build_stage1_response


class Stage1ResponseTests(unittest.TestCase):
    def test_stage1_response_normalizes_neuro_alias_without_zero_complaint_id(
        self,
    ) -> None:
        response = _build_stage1_response(
            {
                "ktas": 2,
                "chief_complaint": "acute focal weakness",
                "sbar": {"A": {"spo2": 94}},
            }
        )

        self.assertEqual(response.case.complaint_id, 3)
        self.assertNotEqual(response.case.complaint_id, 0)
        self.assertEqual(response.case.required_procedure_groups, ["ACS_STROKE", "BRAIN_HEMORRHAGE"])

    def test_stage1_response_normalizes_low_back_pain_without_zero_complaint_id(
        self,
    ) -> None:
        response = _build_stage1_response(
            {
                "ktas": 3,
                "chief_complaint": "low back pain",
                "sbar": {"A": {}},
            }
        )

        self.assertEqual(response.case.complaint_id, 7)
        self.assertNotEqual(response.case.complaint_id, 0)

    def test_stage1_response_rejects_unknown_complaint_instead_of_returning_zero(
        self,
    ) -> None:
        with self.assertRaises(HTTPException) as cm:
            _build_stage1_response(
                {
                    "ktas": 3,
                    "chief_complaint": "unknown label",
                    "sbar": {"A": {}},
                }
            )

        self.assertEqual(cm.exception.status_code, 400)
        self.assertEqual(cm.exception.detail["reason"], "unknown_chief_complaint")


if __name__ == "__main__":
    unittest.main()
