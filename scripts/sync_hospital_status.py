from __future__ import annotations

import argparse
import os
import re
import sys
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Iterable, Sequence

import requests
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.config_beds import BED_TYPE_FUNCS
from app.schemas import HospitalBasicInfo, HospitalRealtime

SUPABASE_REST_TIMEOUT_SECONDS = 20


def safe_int(value: Any) -> int:
    if value is None:
        return 0
    try:
        text = str(value).strip()
        if not text:
            return 0
        return int(text)
    except (TypeError, ValueError):
        return 0


def sanitize_error_text(value: Any) -> str:
    text = str(value)
    return re.sub(r"(serviceKey=)[^&\s)]+", r"\1<redacted>", text)


def display_beds(value: Any) -> int:
    return max(safe_int(value), 0)


def first_positive(mapping: dict[str, Any], keys: Iterable[str]) -> int:
    for key in keys:
        value = display_beds(mapping.get(key))
        if value > 0:
            return value
    return 0


def sum_bed_types(realtime: HospitalRealtime, bed_types: Iterable[str]) -> int:
    total = 0
    for bed_type in bed_types:
        func = BED_TYPE_FUNCS.get(bed_type)
        if func is None:
            continue
        total += display_beds(func(realtime))
    return total


def normalize_hospital_status(realtime: HospitalRealtime) -> dict[str, Any]:
    er_available = display_beds(realtime.er_beds)
    icu_available = sum_bed_types(
        realtime,
        ("icu_general", "icu_neonatal", "icu_neuro", "icu_burn"),
    )
    isolation_available = (
        display_beds(realtime.raw_hv.get("hv29"))
        + display_beds(realtime.raw_hv.get("hv30"))
        + display_beds(realtime.raw_hv.get("hv41"))
    )

    er_total = max(
        er_available,
        first_positive(
            realtime.baseline_hvs,
            ("hvs01", "hvs1", "hvs10"),
        ),
    )
    icu_total = max(
        icu_available,
        first_positive(
            realtime.baseline_hvs,
            ("hvs16", "hvs17", "hvs12", "hvs13", "hvs14", "hvs15"),
        ),
    )
    isolation_total = max(
        isolation_available,
        first_positive(
            realtime.baseline_hvs,
            ("hvs18", "hvs19", "hvs20", "hvs21", "hvs22", "hvs23"),
        ),
    )

    available_beds = er_available + icu_available + isolation_available
    total_beds = er_total + icu_total + isolation_total
    bed_services = [
        {"name": "ER", "available": er_available, "total": er_total},
        {"name": "ICU", "available": icu_available, "total": icu_total},
        {
            "name": "Isolation",
            "available": isolation_available,
            "total": isolation_total,
        },
    ]

    return {
        "hospital_id": realtime.id,
        "available_beds": available_beds,
        "total_beds": total_beds,
        "er_available_beds": er_available,
        "er_total_beds": er_total,
        "icu_available_beds": icu_available,
        "icu_total_beds": icu_total,
        "isolation_available_beds": isolation_available,
        "isolation_total_beds": isolation_total,
        "bed_services": bed_services,
        "is_accepting": available_beds > 0,
        "status_note": f"Synced from ERMCT realtime beds at {now_iso()}",
        "updated_at": now_iso(),
    }


def normalize_hospital_row(
    realtime: HospitalRealtime,
    basic: HospitalBasicInfo | None,
    sido: str,
    sigungu: str,
) -> dict[str, Any]:
    return {
        "id": realtime.id,
        "name": (basic.name if basic and basic.name else realtime.name) or realtime.id,
        "address": basic.address if basic else None,
        "phone": (basic.phone if basic and basic.phone else realtime.phone),
        "emergency_phone": basic.emergency_phone if basic else realtime.phone,
        "latitude": basic.latitude if basic else None,
        "longitude": basic.longitude if basic else None,
        "region_sido": sido,
        "region_sigungu": sigungu,
        "is_active": True,
        "updated_at": now_iso(),
    }


def bed_services_summary(services: Any) -> str:
    if not isinstance(services, list):
        return ""

    parts = []
    for service in services:
        if not isinstance(service, dict):
            continue
        name = str(service.get("name") or "").strip()
        if not name:
            continue
        available = safe_int(service.get("available"))
        total = safe_int(service.get("total"))
        parts.append(f"{name} {available}/{total}")
    return ", ".join(parts)


def verbose_status_line(
    hospital_row: dict[str, Any],
    status_row: dict[str, Any],
) -> str:
    hospital_id = status_row["hospital_id"]
    hospital_name = hospital_row.get("name") or hospital_id
    return (
        f"{hospital_id} | {hospital_name} | "
        f"available_beds={status_row['available_beds']} | "
        f"total_beds={status_row['total_beds']} | "
        f"services={bed_services_summary(status_row.get('bed_services'))}"
    )


def status_summary(status_rows: list[dict[str, Any]]) -> dict[str, int]:
    return {
        "fetched_count": len(status_rows),
        "accepting_count": sum(1 for row in status_rows if row.get("is_accepting")),
        "total_available_beds": sum(
            safe_int(row.get("available_beds")) for row in status_rows
        ),
    }


def now_iso() -> str:
    return datetime.now(UTC).isoformat()


def chunked(rows: list[dict[str, Any]], size: int) -> Iterable[list[dict[str, Any]]]:
    for index in range(0, len(rows), size):
        yield rows[index : index + size]


def supabase_headers(service_role_key: str) -> dict[str, str]:
    return {
        "apikey": service_role_key,
        "Authorization": f"Bearer {service_role_key}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }


def upsert_supabase_rows(
    supabase_url: str,
    service_role_key: str,
    table: str,
    conflict_column: str,
    rows: list[dict[str, Any]],
) -> int:
    if not rows:
        return 0

    base_url = supabase_url.rstrip("/")
    url = f"{base_url}/rest/v1/{table}?on_conflict={conflict_column}"
    total = 0
    headers = supabase_headers(service_role_key)

    for batch in chunked(rows, 100):
        response = requests.post(
            url,
            headers=headers,
            json=batch,
            timeout=SUPABASE_REST_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        total += len(batch)

    return total


def positive_int(value: str) -> int:
    parsed = safe_int(value)
    if parsed <= 0:
        raise argparse.ArgumentTypeError("must be a positive integer")
    return parsed


def missing_required_env(args: argparse.Namespace) -> list[str]:
    missing = []
    if not os.getenv("ERMCT_SERVICE_KEY"):
        missing.append("ERMCT_SERVICE_KEY")
    if not (args.sido or os.getenv("HOSPITAL_STATUS_SYNC_SIDO")):
        missing.append("HOSPITAL_STATUS_SYNC_SIDO or --sido")
    if not (args.sigungu or os.getenv("HOSPITAL_STATUS_SYNC_SIGUNGU")):
        missing.append("HOSPITAL_STATUS_SYNC_SIGUNGU or --sigungu")
    if not args.dry_run:
        if not os.getenv("SUPABASE_URL"):
            missing.append("SUPABASE_URL")
        if not os.getenv("SUPABASE_SERVICE_ROLE_KEY"):
            missing.append("SUPABASE_SERVICE_ROLE_KEY")
    return missing


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Fetch ERMCT realtime emergency bed data and upsert normalized rows "
            "into Supabase hospitals and hospital_status."
        ),
        epilog=(
            "Default mode runs once. Use --dry-run to inspect normalized rows "
            "without writing to Supabase. Use --interval-seconds for local "
            "continuous operation; each cycle logs a timestamped summary."
        ),
    )
    parser.add_argument(
        "--sido",
        help=(
            "ERMCT STAGE1 region. Falls back to HOSPITAL_STATUS_SYNC_SIDO. "
            "Example: 경기도"
        ),
    )
    parser.add_argument(
        "--sigungu",
        help=(
            "ERMCT STAGE2 city/county/district. Falls back to "
            "HOSPITAL_STATUS_SYNC_SIGUNGU. Example: 성남시"
        ),
    )
    parser.add_argument(
        "--num-rows",
        type=positive_int,
        default=200,
        help="ERMCT numOfRows value per fetch. Default: 200.",
    )
    parser.add_argument(
        "--page-no",
        type=positive_int,
        default=1,
        help="ERMCT pageNo value. Default: 1.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Fetch and normalize data, but skip Supabase upserts.",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Print each normalized hospital_status row summary.",
    )
    parser.add_argument(
        "--once",
        action="store_true",
        default=True,
        help="Run one sync cycle and exit. This is the default behavior.",
    )
    parser.add_argument(
        "--interval-seconds",
        type=positive_int,
        help=(
            "Run continuously with this many seconds between sync cycles. "
            "Failed cycles are logged and the next cycle still runs."
        ),
    )
    parser.add_argument(
        "--skip-basic-info",
        action="store_true",
        help="Do not call basic-info API for hospital row enrichment.",
    )
    return parser.parse_args(argv)


def run_sync_once(args: argparse.Namespace) -> int:
    sido = args.sido or os.environ["HOSPITAL_STATUS_SYNC_SIDO"]
    sigungu = args.sigungu or os.environ["HOSPITAL_STATUS_SYNC_SIGUNGU"]

    from app.services.ermct_client import ErmctClient

    client = ErmctClient()
    fetched = 0
    failed = 0
    hospital_rows: list[dict[str, Any]] = []
    status_rows: list[dict[str, Any]] = []

    try:
        realtime_rows = client.get_realtime_beds(
            sido=sido,
            sigungu=sigungu,
            num_rows=args.num_rows,
            page_no=args.page_no,
        )
    except Exception as exc:
        print(f"Failed to fetch ERMCT realtime beds: {sanitize_error_text(exc)}")
        return 1
    fetched = len(realtime_rows)

    seen: set[str] = set()
    for realtime in realtime_rows:
        if not realtime.id or realtime.id in seen:
            continue
        seen.add(realtime.id)

        try:
            basic = None
            if not args.skip_basic_info:
                basic = client.get_basic_info(realtime.id)

            hospital_rows.append(normalize_hospital_row(realtime, basic, sido, sigungu))
            status_rows.append(normalize_hospital_status(realtime))
        except Exception as exc:
            failed += 1
            print(f"[WARN] failed to normalize hpid={realtime.id}: {exc}")

    if args.verbose:
        print("Hospitals:")
        for hospital_row, status_row in zip(hospital_rows, status_rows):
            print(verbose_status_line(hospital_row, status_row))

    target_id = "A2116806"
    target_index = next(
        (
            index
            for index, row in enumerate(status_rows)
            if row.get("hospital_id") == target_id
        ),
        None,
    )

    if target_index is None:
        print(f"{target_id} status: missing")
        if args.verbose:
            print("Fetched hospital ids/names:")
            for hospital_row in hospital_rows:
                hospital_id = hospital_row.get("id")
                hospital_name = hospital_row.get("name") or hospital_id
                print(f"- {hospital_id} | {hospital_name}")
    else:
        print(f"{target_id} status: found")
        print(
            "A2116806 normalized row: "
            f"{status_rows[target_index]}"
        )

    upserted = 0
    if args.dry_run:
        print("[DRY RUN] Supabase upsert skipped.")
    else:
        supabase_url = os.environ["SUPABASE_URL"]
        service_role_key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
        upserted += upsert_supabase_rows(
            supabase_url,
            service_role_key,
            "hospitals",
            "id",
            hospital_rows,
        )
        upserted += upsert_supabase_rows(
            supabase_url,
            service_role_key,
            "hospital_status",
            "hospital_id",
            status_rows,
        )

    print(f"fetched count: {fetched}")
    print(f"upserted count: {upserted}")
    print(f"failed count: {failed}")

    summary = status_summary(status_rows)
    print("summary:")
    print(f"fetched_count: {summary['fetched_count']}")
    print(f"accepting_count: {summary['accepting_count']}")
    print(f"total_available_beds: {summary['total_available_beds']}")

    if args.dry_run and status_rows:
        sample = status_rows[0]
        print(
            "sample status: "
            f"hospital_id={sample['hospital_id']} "
            f"available_beds={sample['available_beds']} "
            f"total_beds={sample['total_beds']}"
        )

    return 0 if failed == 0 else 1


def main(argv: Sequence[str] | None = None) -> int:
    load_dotenv()
    args = parse_args(argv)

    missing = missing_required_env(args)
    if missing:
        print("Missing required configuration:")
        for name in missing:
            print(f"- {name}")
        return 2

    if not args.interval_seconds:
        return run_sync_once(args)

    while True:
        started_at = now_iso()
        print(f"[{started_at}] sync cycle started")
        try:
            exit_code = run_sync_once(args)
        except Exception as exc:
            exit_code = 1
            print(f"[{now_iso()}] sync cycle failed: {sanitize_error_text(exc)}")
        else:
            print(f"[{now_iso()}] sync cycle summary: exit_code={exit_code}")
        time.sleep(args.interval_seconds)


if __name__ == "__main__":
    raise SystemExit(main())
