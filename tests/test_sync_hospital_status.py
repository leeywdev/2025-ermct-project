from __future__ import annotations

import contextlib
import io
import unittest

from app.schemas import HospitalRealtime
from scripts.sync_hospital_status import (
    bed_services_summary,
    normalize_hospital_status,
    parse_args,
    status_summary,
    sanitize_error_text,
    verbose_status_line,
    safe_int,
)


def realtime(**overrides):
    values = {
        "id": "H001",
        "name": "Test Hospital",
        "raw_hv": {},
        "baseline_hvs": {},
    }
    values.update(overrides)

    construct = getattr(HospitalRealtime, "model_construct", None)
    if construct is not None:
        return construct(**values)
    return HospitalRealtime.construct(**values)


class SyncHospitalStatusTests(unittest.TestCase):
    def test_safe_int_handles_missing_and_invalid_values(self) -> None:
        self.assertEqual(safe_int(None), 0)
        self.assertEqual(safe_int(""), 0)
        self.assertEqual(safe_int("not-a-number"), 0)
        self.assertEqual(safe_int(" 7 "), 7)

    def test_normalize_hospital_status_clamps_negative_display_values(self) -> None:
        status = normalize_hospital_status(
            realtime(
                er_beds=-1,
                general_icu_beds="-2",
                neonatal_icu_beds=3,
                raw_hv={"hv29": "-4", "hv30": 5},
                baseline_hvs={"hvs01": 10, "hvs16": 4, "hvs17": 6},
            )
        )

        self.assertEqual(status["er_available_beds"], 0)
        self.assertEqual(status["icu_available_beds"], 3)
        self.assertEqual(status["isolation_available_beds"], 5)
        self.assertEqual(status["available_beds"], 8)
        self.assertTrue(status["is_accepting"])

    def test_normalize_hospital_status_builds_bed_services(self) -> None:
        status = normalize_hospital_status(
            realtime(
                er_beds="2",
                general_icu_beds="1",
                raw_hv={"hv29": 4},
                baseline_hvs={"hvs01": 7, "hvs16": 3},
            )
        )

        self.assertEqual(
            status["bed_services"],
            [
                {"name": "ER", "available": 2, "total": 7},
                {"name": "ICU", "available": 1, "total": 3},
                {"name": "Isolation", "available": 4, "total": 4},
            ],
        )

    def test_bed_services_summary_formats_services_compactly(self) -> None:
        services = [
            {"name": "ER", "available": 2, "total": 7},
            {"name": "ICU", "available": 1, "total": 3},
        ]

        self.assertEqual(bed_services_summary(services), "ER 2/7, ICU 1/3")

    def test_verbose_status_line_includes_required_fields(self) -> None:
        hospital = {"id": "A2116806", "name": "Seongnam Medical Center"}
        status = {
            "hospital_id": "A2116806",
            "available_beds": 3,
            "total_beds": 10,
            "bed_services": [
                {"name": "ER", "available": 2, "total": 7},
                {"name": "ICU", "available": 1, "total": 3},
            ],
        }

        self.assertEqual(
            verbose_status_line(hospital, status),
            "A2116806 | Seongnam Medical Center | available_beds=3 | "
            "total_beds=10 | services=ER 2/7, ICU 1/3",
        )

    def test_status_summary_counts_accepting_and_available_beds(self) -> None:
        rows = [
            {"available_beds": 3, "is_accepting": True},
            {"available_beds": 0, "is_accepting": False},
            {"available_beds": "4", "is_accepting": True},
        ]

        self.assertEqual(
            status_summary(rows),
            {
                "fetched_count": 3,
                "accepting_count": 2,
                "total_available_beds": 7,
            },
        )

    def test_normalize_hospital_status_never_reports_total_below_available(self) -> None:
        status = normalize_hospital_status(
            realtime(
                er_beds=11,
                raw_hv={"hv29": 34},
                baseline_hvs={"hvs01": 1, "hvs18": 5},
            )
        )

        self.assertEqual(status["er_total_beds"], 11)
        self.assertEqual(status["isolation_total_beds"], 34)
        self.assertEqual(status["total_beds"], status["available_beds"])

    def test_sanitize_error_text_redacts_service_key(self) -> None:
        raw = "url?serviceKey=secret-value&STAGE1=x"

        self.assertEqual(
            sanitize_error_text(raw),
            "url?serviceKey=<redacted>&STAGE1=x",
        )

    def test_parse_args_defaults_to_once_without_interval(self) -> None:
        args = parse_args([])

        self.assertTrue(args.once)
        self.assertIsNone(args.interval_seconds)

    def test_parse_args_accepts_positive_interval(self) -> None:
        args = parse_args(["--interval-seconds", "300"])

        self.assertEqual(args.interval_seconds, 300)

    def test_parse_args_rejects_non_positive_interval(self) -> None:
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            parse_args(["--interval-seconds", "0"])


if __name__ == "__main__":
    unittest.main()
