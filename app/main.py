# app/main.py
import os

from fastapi import FastAPI, Query, Response, Body, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pathlib import Path
from typing import Dict, List, Set, Optional, Sequence, Tuple
from fastapi import UploadFile, File # UploadFile, File 추가
# 뒤에 ', get_whisper_model' 을 꼭 붙여야 합니다!
from app.stt_cleaner import ktas_from_audio, ktas_from_text, build_stage2_payload, get_whisper_model
from pydantic import BaseModel

from .services.ermct_client import ErmctClient
from .services.sigungu_search import (
    ExpansionPolicy,
    ProgressiveSearchResult,
    SigunguAdjacencyIndex,
    build_expansion_levels,
    load_sigungu_adjacency,
    search_regions_progressively,
)
from .services.region_resolver import KakaoRegionResolver

from app.schemas import (
    HospitalRealtime,
    HospitalBasicInfo,
    SeriousDiseaseStatus,
    HospitalMessage,
    HospitalSummary,
    TriageRequest,
    RecommendedHospital,
    TraumaCenter,
    HospitalComplaintCoverage,
    RoutingCandidateHospital,
    HospitalProcedureBeds,
    RoutingCase,
    KTASRoutingRequest,
    RoutingCandidateResponse,
    NearestRoutingRequest,
    RoutePathRequest,
    RoutePathResponse,
    RoutePathPoint,
)
from app.triage_utils import (
    procedure_status_for_hospital,
    get_effective_beds_for_groups,
)

from app.procedure_groups import (
    compute_procedure_availability,
    humanize_procedure_groups,
    PROCEDURE_GROUPS,
)

from app.complaint_mapping import (
    required_procedure_groups_for_complaint,
    complaints_supported_by_hospital,
    complaint_id_from_chief_complaint,
    COMPLAINT_LABELS,
)
from app.routers.reservations import router as reservations_router


class TextKTASRequest(BaseModel):
    text: str

# 3단계 import
from .distance_logic import calculate_all_distances_async, get_top3, get_tmap_route_async

SERIOUS_MKIOSK_KEYS = [f"MKioskTy{i}" for i in range(1, 28)]  # 1 ~ 27

# 서울 25개 구
SEOUL_SIGUNGU_LIST = [
    "강남구", "강동구", "강북구", "강서구",
    "관악구", "광진구", "구로구", "금천구",
    "노원구", "도봉구", "동대문구", "동작구",
    "마포구", "서대문구", "서초구", "성동구",
    "성북구", "송파구", "양천구", "영등포구",
    "용산구", "은평구", "종로구", "중구", "중랑구",
]

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
SIGUNGU_ADJACENCY_PATH = DATA_DIR / "sigungu_adjacency.json"
DEFAULT_EXPANSION_POLICY = ExpansionPolicy(top_touching_limit=3)
sigungu_adjacency_index: Optional[SigunguAdjacencyIndex] = None
kakao_region_resolver = KakaoRegionResolver()

SIDO_CODE_TO_NAME: Dict[str, str] = {
    "11": "서울특별시",
    "26": "부산광역시",
    "27": "대구광역시",
    "28": "인천광역시",
    "29": "광주광역시",
    "30": "대전광역시",
    "31": "울산광역시",
    "36": "세종특별자치시",
    "41": "경기도",
    "42": "강원특별자치도",
    "43": "충청북도",
    "44": "충청남도",
    "45": "전북특별자치도",
    "46": "전라남도",
    "47": "경상북도",
    "48": "경상남도",
    "50": "제주특별자치도",
}

SIDO_CODE_TO_NAME = {
    "11": "서울특별시",
    "21": "부산광역시",
    "22": "대구광역시",
    "23": "인천광역시",
    "24": "광주광역시",
    "25": "대전광역시",
    "26": "울산광역시",
    "29": "세종특별자치시",
    "31": "경기도",
    "32": "강원특별자치도",
    "33": "충청북도",
    "34": "충청남도",
    "35": "전북특별자치도",
    "36": "전라남도",
    "37": "경상북도",
    "38": "경상남도",
    "39": "제주특별자치도",
}


def _get_all_seoul_summaries(sm_type: int = 1) -> List[HospitalSummary]:
    """
    서울특별시 전체 25개 구에 대해
    get_hospital_summaries_by_region()를 돌려서
    중복 없이 HospitalSummary 리스트를 만들어준다.
    """
    all_summaries: List[HospitalSummary] = []
    seen: Set[str] = set()

    for gu in SEOUL_SIGUNGU_LIST:
        region_sums = get_hospital_summaries_by_region(
            sido="서울특별시",
            sigungu=gu,
            sm_type=sm_type,
            num_rows=200,
        )
        for s in region_sums:
            if not s.id or s.id in seen:
                continue
            seen.add(s.id)
            all_summaries.append(s)

    return all_summaries


def _get_all_indexed_summaries(sm_type: int = 1) -> List[HospitalSummary]:
    adjacency = _get_sigungu_adjacency_index()

    all_summaries: List[HospitalSummary] = []
    seen: Set[str] = set()
    failure_count = 0
    throttled_count = 0
    failure_samples: List[str] = []
    max_failure_samples = 5
    throttle_abort_limit = 5

    for sigungu_code in adjacency.all_codes:
        sigungu_name = adjacency.get_name(sigungu_code)
        sido_code = adjacency.get_sido_code(sigungu_code)
        sido_name = SIDO_CODE_TO_NAME.get(sido_code) if sido_code else None
        if not sigungu_name or not sido_name:
            continue

        try:
            region_sums = get_hospital_summaries_by_region(
                sido=sido_name,
                sigungu=sigungu_name,
                sm_type=sm_type,
                num_rows=200,
            )
        except Exception as exc:
            failure_count += 1
            error_text = str(exc)
            if "429" in error_text:
                throttled_count += 1

            if len(failure_samples) < max_failure_samples:
                failure_samples.append(
                    f"{sido_name} {sigungu_name}: {error_text}"
                )

            if throttled_count >= throttle_abort_limit:
                print(
                    "[GLOBAL FALLBACK] aborted due to rate limit "
                    f"after {throttled_count} throttled regions"
                )
                break
            continue

        for summary in region_sums:
            if not summary.id or summary.id in seen:
                continue
            seen.add(summary.id)
            all_summaries.append(summary)

    if failure_count:
        print(
            "[GLOBAL FALLBACK] failures "
            f"count={failure_count} throttled={throttled_count} "
            f"samples={failure_samples}"
        )

    return all_summaries


def _resolve_home_hpid_from_followup(
    summaries: List[HospitalSummary],
    hospital_followup: Optional[str],
) -> Optional[str]:
    """
    KTAS 모듈에서 넘어온 hospital_followup(병원명 or HPID)을
    내부 home_hpid(HPID)로 해석.
    - "A1100010" 같이 HPID 형태면 그대로 사용
    - 아니면 이름 substring 매칭으로 찾아본다.
    """
    if not hospital_followup:
        return None

    text = hospital_followup.strip()
    if not text:
        return None

    # 1) 이미 HPID 형식인 경우
    if text.startswith("A") and text[1:].isdigit():
        return text

    # 2) 이름 기반 매칭
    target = text.replace(" ", "")

    for s in summaries:
        basic = s.basic
        name = s.name or (basic.name if basic and basic.name else None)
        if not name:
            continue
        cand = name.replace(" ", "")
        if target in cand:
            return s.id

    return None


def _resolve_current_sigungu_code(req: KTASRoutingRequest) -> Optional[str]:
    adjacency = _get_sigungu_adjacency_index()

    if req.current_sigungu_code:
        return req.current_sigungu_code.strip()

    if req.current_sigungu_name:
        resolved = adjacency.get_code(req.current_sigungu_name)
        if resolved:
            return resolved

        normalized = req.current_sigungu_name.strip().replace(" ", "")
        for code, name in adjacency.code_to_name.items():
            compact_name = name.replace(" ", "")
            if normalized in compact_name or compact_name in normalized:
                return code

    return None


def _resolve_current_region(req: KTASRoutingRequest) -> Tuple[Optional[str], Optional[str]]:
    adjacency = _get_sigungu_adjacency_index()

    current_sigungu_code = _resolve_current_sigungu_code(req)
    if current_sigungu_code:
        sido_code = adjacency.get_sido_code(current_sigungu_code)
        if sido_code:
            return current_sigungu_code, SIDO_CODE_TO_NAME.get(sido_code)

    if req.user_lat is not None and req.user_lon is not None:
        try:
            resolved = kakao_region_resolver.resolve_sigungu(req.user_lat, req.user_lon)
        except Exception as exc:
            print(f"[REGION RESOLVER] Kakao resolver failed: {exc}")
            return current_sigungu_code, None

        if not resolved:
            return current_sigungu_code, None

        code = current_sigungu_code
        if not code:
            direct = adjacency.get_code(resolved.sigungu_name)
            if direct:
                code = direct
            else:
                normalized = resolved.sigungu_name.strip().replace(" ", "")
                for candidate_code, name in adjacency.code_to_name.items():
                    compact_name = name.replace(" ", "")
                    if normalized in compact_name or compact_name in normalized:
                        code = candidate_code
                        break

        sido_name = resolved.sido_name
        if not sido_name and code:
            sido_code = adjacency.get_sido_code(code)
            if sido_code:
                sido_name = SIDO_CODE_TO_NAME.get(sido_code)

        return code, sido_name

    return current_sigungu_code, None


def _build_routing_candidates_from_summaries(
    req: KTASRoutingRequest,
    complaint_id: int,
    required_groups: List[str],
    complaint_label: str,
    summaries: List[HospitalSummary],
) -> List[RoutingCandidateHospital]:
    home_hpid = _resolve_home_hpid_from_followup(
        summaries=summaries,
        hospital_followup=req.hospital_followup,
    )

    candidates: List[RoutingCandidateHospital] = []
    debug_enabled = os.getenv("ROUTING_DEBUG", "").lower() in {"1", "true", "yes", "on"}

    for s in summaries:
        basic = s.basic
        if not basic:
            if debug_enabled:
                print(f"[CANDIDATE DROP] hpid={s.id} reason=no_basic")
            continue

        lat = basic.latitude
        lon = basic.longitude
        if lat is None or lon is None:
            if debug_enabled:
                print(f"[CANDIDATE DROP] hpid={s.id} name={s.name or basic.name or s.id} reason=no_latlon")
            continue

        duty_eryn = basic.raw_fields.get("dutyEryn") if basic.raw_fields else None
        if duty_eryn != "1":
            if debug_enabled:
                print(
                    f"[CANDIDATE DROP] hpid={s.id} name={s.name or basic.name or s.id} "
                    f"reason=dutyEryn value={duty_eryn!r}"
                )
            continue

        proc_status = procedure_status_for_hospital(s, required_groups)
        if not proc_status:
            if debug_enabled:
                print(
                    f"[CANDIDATE DROP] hpid={s.id} name={s.name or basic.name or s.id} "
                    f"reason=no_proc_status required_groups={required_groups}"
                )
            continue

        groups_with_beds = [
            gid
            for gid, info in proc_status.items()
            if info.get("effective_beds", 0) > 0
        ]
        if not groups_with_beds:
            if debug_enabled:
                status_bits = {
                    gid: {
                        "api_beds": info.get("api_beds", 0),
                        "effective_beds": info.get("effective_beds", 0),
                    }
                    for gid, info in proc_status.items()
                }
                print(
                    f"[CANDIDATE DROP] hpid={s.id} name={s.name or basic.name or s.id} "
                    f"reason=no_groups_with_beds proc_status={status_bits}"
                )
            continue

        if s.realtime:
            _, total_eff, _ = get_effective_beds_for_groups(
                hpid=s.id,
                realtime=s.realtime,
                group_ids=groups_with_beds,
            )
        else:
            total_eff = 0

        if total_eff <= 0:
            if debug_enabled:
                print(
                    f"[CANDIDATE DROP] hpid={s.id} name={s.name or basic.name or s.id} "
                    f"reason=total_eff_le_zero groups_with_beds={groups_with_beds} total_eff={total_eff}"
                )
            continue

        coverage_score, coverage_level = _compute_coverage_score_and_level(
            required_groups=required_groups,
            groups_with_beds=groups_with_beds,
        )
        groups_with_beds_labels = humanize_procedure_groups(groups_with_beds)

        supported_complaints = sorted(list(complaints_supported_by_hospital(s)))
        supported_labels = [
            COMPLAINT_LABELS[cid]
            for cid in supported_complaints
            if cid in COMPLAINT_LABELS
        ]

        mkiosk_flags: List[str] = []
        if s.serious and s.serious.mkiosk:
            mkiosk_flags.extend(
                [
                    k
                    for k, v in s.serious.mkiosk.items()
                    if v and str(v).upper().startswith("Y")
                ]
            )
        if basic.raw_fields:
            for k, v in basic.raw_fields.items():
                if not k.startswith("MKioskTy"):
                    continue
                if v and str(v).upper().startswith("Y") and k not in mkiosk_flags:
                    mkiosk_flags.append(k)

        is_home = bool(home_hpid and s.id == home_hpid)
        base_score = float(total_eff + (100 if is_home else 0))
        priority_score = _apply_coverage_weight(
            base_score=base_score,
            coverage_level=coverage_level,
            coverage_score=coverage_score,
        )

        reason = _build_reason_summary_with_coverage(
            ktas=req.ktas_level,
            complaint_label=complaint_label,
            groups_with_beds_labels=groups_with_beds_labels,
            groups_with_beds=groups_with_beds,
            total_eff=total_eff,
            coverage_level=coverage_level,
            coverage_score=coverage_score,
        )

        candidates.append(
            RoutingCandidateHospital(
                id=s.id,
                name=s.name or basic.name or s.id,
                address=basic.address or "",
                phone=basic.phone,
                emergency_phone=basic.emergency_phone,
                latitude=lat,
                longitude=lon,
                procedure_beds=proc_status,
                total_effective_beds=total_eff,
                has_any_bed=True,
                groups_with_beds=groups_with_beds,
                groups_with_beds_labels=groups_with_beds_labels,
                supported_complaints=supported_complaints,
                supported_complaint_labels=supported_labels,
                mkiosk_flags=sorted(mkiosk_flags),
                coverage_score=coverage_score,
                coverage_level=coverage_level,
                priority_score=priority_score,
                reason_summary=reason,
            )
        )

    candidates.sort(key=lambda c: (-c.priority_score, -c.total_effective_beds))
    return candidates


def _build_stage1_response(stage1_result: dict) -> RoutingCandidateResponse:
    payload_dict = build_stage2_payload(stage1_result)
    chief_complaint = payload_dict.get("chief_complaint", "unknown")
    complaint_id = complaint_id_from_chief_complaint(chief_complaint)
    if not complaint_id:
        complaint_id = 0
        complaint_label = chief_complaint
        required_groups: List[str] = []
        required_group_labels: List[str] = []
    else:
        complaint_label = COMPLAINT_LABELS.get(complaint_id, chief_complaint)
        required_groups = required_procedure_groups_for_complaint(complaint_id)
        required_group_labels = humanize_procedure_groups(required_groups)

    routing_case = RoutingCase(
        ktas=payload_dict.get("ktas_level", 0),
        complaint_id=complaint_id,
        complaint_label=complaint_label,
        required_procedure_groups=required_groups,
        required_procedure_group_labels=required_group_labels,
    )

    stt_vitals = (
        stage1_result.get("sbar", {}).get("A", {})
        if isinstance(stage1_result, dict)
        else {}
    )

    # 기존 병원이 있으면 추가
    hospitals: List[RoutingCandidateHospital] = []
    followup_hospital = payload_dict.get("hospital_followup")
    followup_id = None
    
    if followup_hospital:
        followup_id = followup_hospital
        hospitals.append(
            RoutingCandidateHospital(
                id=followup_hospital,
                name=followup_hospital,
                address="",
                phone="",
                emergency_phone="",
                latitude=0.0,
                longitude=0.0,
                procedure_beds={},
                total_effective_beds=0,
                has_any_bed=False,
                groups_with_beds=[],
                groups_with_beds_labels=[],
                supported_complaints=[],
                supported_complaint_labels=[],
                mkiosk_flags=[],
                coverage_score=0.0,
                coverage_level="NONE",
                priority_score=0.0,
                reason_summary="환자가 지정한 병원",
            )
        )

    return RoutingCandidateResponse(
        followup_id=followup_id,
        hospitals=hospitals,
        case=routing_case, 
        stt_vitals=stt_vitals,
        ktas_options=stage1_result.get("ktas_options") if isinstance(stage1_result, dict) else None,
    )


def _search_routing_candidates_progressively(
    req: KTASRoutingRequest,
    complaint_id: int,
    required_groups: List[str],
    complaint_label: str,
    base_sigungu_code: str,
    base_sido_name: Optional[str],
) -> tuple[List[RoutingCandidateHospital], ProgressiveSearchResult[RoutingCandidateHospital]]:
    adjacency = _get_sigungu_adjacency_index()
    base_code = base_sigungu_code

    levels = build_expansion_levels(
        base_code=base_code,
        adjacency_index=adjacency,
        policy=DEFAULT_EXPANSION_POLICY,
    )

    def fetch_candidates(sigungu_code: str) -> Sequence[RoutingCandidateHospital]:
        sigungu_name = adjacency.get_name(sigungu_code)
        if not sigungu_name:
            raise ValueError(f"시군구 코드에 대응하는 이름이 없습니다: {sigungu_code}")

        sido_code = adjacency.get_sido_code(sigungu_code)
        sido_name = SIDO_CODE_TO_NAME.get(sido_code) if sido_code else None
        if not sido_name:
            sido_name = base_sido_name
        if not sido_name:
            raise ValueError(f"시군구 코드에 대응하는 시도 이름이 없습니다: {sigungu_code}")

        summaries = get_hospital_summaries_by_region(
            sido=sido_name,
            sigungu=sigungu_name,
            sm_type=1,
            num_rows=200,
        )
        print(
            "[SIGUNGU FETCH] "
            f"code={sigungu_code} sido={sido_name} sigungu={sigungu_name} "
            f"raw_summary_count={len(summaries)} "
            f"sample_hpids={[s.id for s in summaries[:5] if s.id]}"
        )
        return _build_routing_candidates_from_summaries(
            req=req,
            complaint_id=complaint_id,
            required_groups=required_groups,
            complaint_label=complaint_label,
            summaries=summaries,
        )

    search_result = search_regions_progressively(
        levels=levels,
        fetch_valid_items=fetch_candidates,
        item_key=lambda hospital: hospital.id,
        min_valid_items=req.min_valid_hospitals,
        code_to_name=adjacency.code_to_name,
    )

    candidates = sorted(
        search_result.items,
        key=lambda c: (-c.priority_score, -c.total_effective_beds),
    )
    return candidates, search_result

def _compute_coverage_score_and_level(
    required_groups: List[str],
    groups_with_beds: List[str],
) -> Tuple[float, str]:
    """
    required_procedure_groups 대비 실제로 effective_beds>0 인 그룹 비율 + 등급 계산

    - score = (coverage_count / len(required_groups))  (0.0 ~ 1.0)
    - level:
        * FULL   : score == 1.0
        * HIGH   : 0.75 <= score < 1.0
        * MEDIUM : 0.5  <= score < 0.75
        * LOW    : 0.0  <  score < 0.5
        * NONE   : score == 0.0
    """
    if not required_groups:
        return 0.0, "NONE"

    req_set = set(required_groups)
    covered = sum(1 for g in groups_with_beds if g in req_set)
    score = covered / len(req_set)

    if score <= 0.0:
        level = "NONE"
    elif score >= 1.0:
        level = "FULL"
    elif score >= 0.75:
        level = "HIGH"
    elif score >= 0.5:
        level = "MEDIUM"
    else:
        level = "LOW"

    return score, level


# ----------------- coverage 기반 priority/설명 헬퍼 -----------------

# coverage level → 가중치 매핑
COVERAGE_WEIGHT_BY_LEVEL = {
    "FULL": 1.00,   # 요구 시술 100% 커버
    "HIGH": 0.95,   # 대부분 커버
    "MEDIUM": 0.90, # 절반 이상
    "LOW": 0.80,    # 일부만
    "NONE": 0.70,   # 사실상 커버 안 됨
}

# coverage level → 한글 설명
COVERAGE_LEVEL_LABEL_KO = {
    "FULL": "요청된 시술을 거의 모두 커버",
    "HIGH": "핵심 시술 대부분 가능",
    "MEDIUM": "일부 핵심 시술만 가능",
    "LOW": "필수 시술 중 일부만 가능",
    "NONE": "요청 시술과 직접 일치하는 시술은 거의 없음",
}


def _apply_coverage_weight(
    base_score: float,
    coverage_level: str,
    coverage_score: float | None = None,
) -> float:
    """
    base_score(= home 병원 가산 + 총 유효 병상)를
    coverage level/score에 따라 살짝 가중치 주는 함수.
    """
    weight = COVERAGE_WEIGHT_BY_LEVEL.get(coverage_level, 0.90)

    # coverage_score(0.0~1.0)로 미세 튜닝 (대략 ±0.05 안쪽에서만 움직이게)
    if coverage_score is not None:
        bonus = 0.1 * (coverage_score - 0.7)  # 0.7을 기준으로
        bonus = max(-0.05, min(0.05, bonus))
        weight += bonus

    # 가중치
    weight = max(0.5, min(1.1, weight))

    return round(base_score * weight, 1)


def _build_reason_summary_with_coverage(
    *,
    ktas: int,
    complaint_label: str,
    groups_with_beds_labels: List[str],
    groups_with_beds: List[str],
    total_eff: int,
    coverage_level: str,
    coverage_score: float,
) -> str:
    """
    RoutingCandidateHospital.reason_summary용 문장을
    coverage 정보까지 포함해서 만들어주는 헬퍼.
    """
    if groups_with_beds_labels:
        groups_str = ", ".join(groups_with_beds_labels)
    elif groups_with_beds:
        groups_str = ", ".join(groups_with_beds)
    else:
        groups_str = "관련 시술"

    coverage_desc = COVERAGE_LEVEL_LABEL_KO.get(
        coverage_level,
        f"커버리지 {coverage_level}",
    )
    coverage_pct = int(round(coverage_score * 100))

    return (
        f"KTAS {ktas}, 주증상 '{complaint_label}' 환자에 대해 "
        f"{groups_str} 기준 총 유효 병상 {total_eff}개가 남아 있어 후보로 선정됨. "
        f"(시술 커버리지: {coverage_desc}, 약 {coverage_pct}% 충족)"
    )



app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 개발 단계에서는 * 허용, 추후 제한 필요해보임
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(reservations_router)

# 전역 클라이언트 인스턴스
ermct_client = ErmctClient()

@app.on_event("startup")
async def startup_event():
    global sigungu_adjacency_index
    print(" [Startup] Whisper AI 모델 로딩 시작...")
    get_whisper_model()
    print(" [Startup] Whisper AI 모델 로딩 완료!")
    sigungu_adjacency_index = load_sigungu_adjacency(SIGUNGU_ADJACENCY_PATH)
    print(f" [Startup] Sigungu adjacency 로딩 완료: {len(sigungu_adjacency_index.all_codes)}개 코드")


def _get_sigungu_adjacency_index() -> SigunguAdjacencyIndex:
    global sigungu_adjacency_index
    if sigungu_adjacency_index is None:
        sigungu_adjacency_index = load_sigungu_adjacency(SIGUNGU_ADJACENCY_PATH)
    return sigungu_adjacency_index

@app.get("/health")
def health_check():
    return {"status": "ok"}


@app.get(
    "/api/hospitals/realtime",
    response_model=list[HospitalRealtime],
)
def get_realtime_hospitals(
    sido: str = Query(..., description="시도명 (예: 서울특별시)"),
    sigungu: str = Query(..., description="시군구명 (예: 강남구)"),
    num_rows: int = Query(50, ge=1, le=200),
):
    """
    특정 시/군/구 기준 실시간 응급실 가용 병상 정보 반환
    """
    return ermct_client.get_realtime_beds(
        sido=sido,
        sigungu=sigungu,
        num_rows=num_rows,
    )


@app.get("/debug/hospitals/realtime/xml")
def debug_realtime_xml(
    sido: str = Query(...),
    sigungu: str = Query(...),
    num_rows: int = Query(5),
    page_no: int = Query(1),
):
    xml = ermct_client.debug_raw_realtime_xml(
        sido=sido,
        sigungu=sigungu,
        num_rows=num_rows,
        page_no=page_no,
    )
    # XML로 반환
    return Response(content=xml, media_type="application/xml")


# --------------------------------------------------------------------
# 1) 응급의료기관 기본정보 조회 (getEgytBassInfoInqire)
# --------------------------------------------------------------------
@app.get(
    "/api/hospitals/basic",
    response_model=HospitalBasicInfo | None,
)
def get_hospital_basic(
    hpid: str = Query(..., description="병원 기관 코드 (HPID, 예: A1100010)"),
):
    """
    HPID 기준 응급의료기관 기본정보 조회
    (주소, 대표전화, 응급실 전화, 위경도 등)
    """
    return ermct_client.get_basic_info(hpid=hpid)


# --------------------------------------------------------------------
# 2) 중증질환자 수용가능 정보 조회 (getSrsillDissAceptncPosblInfoInqire)
# --------------------------------------------------------------------
@app.get(
    "/api/hospitals/serious",
    response_model=list[SeriousDiseaseStatus],
)
def get_serious_hospitals(
    sido: str = Query(..., description="시도명 (예: 서울특별시)"),
    sigungu: str = Query(..., description="시군구명 (예: 강남구)"),
    sm_type: int = Query(
        1,
        description="SM_TYPE (가이드 기준 중증질환 분류 타입: 1/2/3 등)",
    ),
    num_rows: int = Query(30, ge=1, le=200),
    page_no: int = Query(1, ge=1),
):
    """
    시/군/구 기준 중증질환자 수용가능정보 조회

    - MKioskTyXX: 각 중증질환 카테고리의 수용 가능/불가 상태
    - MKioskTyXXMsg: 해당 상태에 대한 상세 메시지
    """
    return ermct_client.get_serious_acceptance(
        sido=sido,
        sigungu=sigungu,
        sm_type=sm_type,
        num_rows=num_rows,
        page_no=page_no,
    )


# --------------------------------------------------------------------
# 3) 응급실 및 중증질환 메시지 조회 (getEmrrmSrsillDissMsgInqire)
# --------------------------------------------------------------------
@app.get(
    "/api/hospitals/messages",
    response_model=list[HospitalMessage],
)
def get_hospital_messages(
    hpid: str = Query(..., description="병원 기관 코드 (HPID, 예: A1100010)"),
    num_rows: int = Query(10, ge=1, le=100),
    page_no: int = Query(1, ge=1),
):
    """
    HPID 기준 응급실/중증질환 메시지 조회

    - 장비 고장, 병상 과밀, 특정 중증질환 수용 불가 등 메시지
    - symBlkMsg / symBlkMsgTyp / symTypCod / symTypCodMag 등 포함
    """
    return ermct_client.get_emergency_messages(
        hpid=hpid,
        num_rows=num_rows,
        page_no=page_no,
    )


# --------------------------------------------------------------------
# 4) 병원 정보 요약 (summary)
# --------------------------------------------------------------------
@app.get(
    "/api/hospitals/summary",
    response_model=HospitalSummary,
)
def get_hospital_summary(
    hpid: str = Query(..., description="병원 기관 코드 (HPID, 예: A1100010)"),
    # 아래 둘은 실시간/중증 수용 정보 찾을 때만 필요
    sido: str | None = Query(
        None,
        description="시도명 (실시간/중증 수용 정보를 함께 조회하려면 필요, 예: 서울특별시)",
    ),
    sigungu: str | None = Query(
        None,
        description="시군구명 (실시간/중증 수용 정보를 함께 조회하려면 필요, 예: 강남구)",
    ),
    sm_type: int = Query(
        1,
        description="중증질환 분류 타입(SM_TYPE), 가이드 기본값 1",
    ),
):
    """
    단일 병원(HPID)에 대한 통합 요약 정보

    - basic: getEgytBassInfoInqire (기본정보)
    - realtime: getEmrrmRltmUsefulSckbdInfoInqire (실시간 가용 병상)
      * sido/sigungu가 주어지면 해당 지역에서 HPID 매칭
    - serious: getSrsillDissAceptncPosblInfoInqire (중증질환 수용 가능정보)
    - messages: getEmrrmSrsillDissMsgInqire (응급실/중증 관련 메시지)
    """

    # 1) 기본정보 (HPID 기반)
    basic = ermct_client.get_basic_info(hpid=hpid)

    # 2) 실시간 병상/장비 정보, 중증 수용, 외상센터 여부 (sido/sigungu가 들어온 경우에만 시도)
    realtime: HospitalRealtime | None = None
    serious: SeriousDiseaseStatus | None = None
    trauma_hpids: Set[str] = set()

    if sido and sigungu:
        # (1) 실시간 병상 리스트 → HPID로 필터
        realtime_list = ermct_client.get_realtime_beds(
            sido=sido,
            sigungu=sigungu,
            num_rows=200,
            page_no=1,
        )
        for r in realtime_list:
            if r.id == hpid:
                realtime = r
                break

        # (2) 중증질환 수용 가능 정보 리스트 → HPID로 필터
        serious_list = ermct_client.get_serious_acceptance(
            sido=sido,
            sigungu=sigungu,
            sm_type=sm_type,
            num_rows=200,
            page_no=1,
        )
        for s in serious_list:
            s_hpid = getattr(s, "id", None)
            if not s_hpid and getattr(s, "raw_fields", None):
                s_hpid = s.raw_fields.get("hpid")
            if s_hpid == hpid:
                serious = s
                break

        # (3) 외상센터 목록 조회해서 HPID 세트 구성
        trauma_list = ermct_client.get_trauma_centers(
            sido=sido,
            sigungu=sigungu,
            num_rows=200,
            page_no=1,
        )
        trauma_hpids = {t.id for t in trauma_list if t.id}

    # 3) 응급실/중증 메시지 (HPID 기반)
    messages = ermct_client.get_emergency_messages(
        hpid=hpid,
        num_rows=50,
        page_no=1,
    )

    # 4) name 결정 (basic → realtime → messages 순으로 Fallback)
    name: str | None = None
    if basic and basic.name:
        name = basic.name
    elif realtime and realtime.name:
        name = realtime.name
    elif messages:
        first_msg = messages[0]
        msg_name = getattr(first_msg, "name", None)
        if msg_name:
            name = msg_name

    is_trauma_center = False
    if trauma_hpids:
        is_trauma_center = hpid in trauma_hpids

    # 요약 객체 생성
    summary = HospitalSummary(
        id=hpid,
        name=name,
        basic=basic,
        realtime=realtime,
        serious=serious,
        messages=messages,
        is_trauma_center=is_trauma_center,
    )

    # 수술/시술 그룹별 가능 여부 계산해서 필드 채우기
    summary.procedure_availability = compute_procedure_availability(summary)

    return summary


# --------------------------------------------------------------------
# 5) 디버그용 raw xml
# --------------------------------------------------------------------
@app.get("/debug/hospitals/serious/xml")
def debug_serious_xml(
    sido: str,
    sigungu: str,
    sm_type: int = 1,
    num_rows: int = 30,
    page_no: int = 1,
):
    # 원시 XML이 필요하면 ErmctClient에 이런 메서드 하나 추가해도 됨:
    xml = ermct_client.debug_raw_serious_xml(
        sido=sido,
        sigungu=sigungu,
        sm_type=sm_type,
        num_rows=num_rows,
        page_no=page_no,
    )
    return Response(content=xml, media_type="application/xml")


@app.get(
    "/api/hospitals/summary/by-region",
    response_model=list[HospitalSummary],
)
def get_hospital_summaries_by_region(
    sido: str = Query(..., description="시도명 (예: 서울특별시)"),
    sigungu: str = Query(..., description="시군구명 (예: 강남구)"),
    sm_type: int = Query(
        1,
        description="중증질환 분류 타입(SM_TYPE), 가이드 기본값 1",
    ),
    num_rows: int = Query(
        200,
        ge=1,
        le=500,
        description="실시간 병상 조회 시 한 번에 가져올 최대 병원 수",
    ),
):
    """
    특정 시/군/구 내 모든 응급의료기관에 대한 통합 요약 정보 리스트

    - basic: getEgytBassInfoInqire (기본정보)
    - realtime: getEmrrmRltmUsefulSckbdInfoInqire (실시간 가용 병상)
    - serious: getSrsillDissAceptncPosblInfoInqire (중증질환 수용 가능정보)
    - messages: getEmrrmSrsillDissMsgInqire (응급실/중증 관련 메시지)
    """

    # 1) 해당 지역 실시간 병상 정보 → 병원 리스트(HPID)
    realtime_list: List[HospitalRealtime] = ermct_client.get_realtime_beds(
        sido=sido,
        sigungu=sigungu,
        num_rows=num_rows,
        page_no=1,
    )

    # 2) 해당 지역 중증질환 수용 가능 정보 한 번에 조회
    serious_list: List[SeriousDiseaseStatus] = ermct_client.get_serious_acceptance(
        sido=sido,
        sigungu=sigungu,
        sm_type=sm_type,
        num_rows=num_rows,
        page_no=1,
    )

    # 2-1) 중증 정보 HPID -> SeriousDiseaseStatus 매핑
    serious_by_hpid: Dict[str, SeriousDiseaseStatus] = {}
    for s in serious_list:
        s_hpid: Optional[str] = None

        # 스키마에 id 필드를 따로 추가해뒀다면 우선 사용
        if hasattr(s, "id"):
            s_hpid = getattr(s, "id")

        # id가 없으면 raw_fields에서 hpid 추출
        if not s_hpid and getattr(s, "raw_fields", None):
            s_hpid = s.raw_fields.get("hpid") or s.raw_fields.get("HPID")

        if s_hpid:
            serious_by_hpid[s_hpid] = s

    # 2-2) 외상센터 목록도 한 번만 조회해서 HPID set으로
    trauma_list: List[TraumaCenter] = ermct_client.get_trauma_centers(
        sido=sido,
        sigungu=sigungu,
        num_rows=200,
        page_no=1,
    )
    trauma_hpids: Set[str] = {t.id for t in trauma_list if t.id}

    results: List[HospitalSummary] = []
    seen: Set[str] = set()

    # 3) 실시간 병상 리스트 기준으로 병원별 summary 구성
    for r in realtime_list:
        hpid = r.id
        if not hpid or hpid in seen:
            continue
        seen.add(hpid)

        # (1) 기본 정보
        basic = ermct_client.get_basic_info(hpid=hpid)

        # (2) 중증 정보: 미리 만든 매핑에서 가져오기
        serious = serious_by_hpid.get(hpid)

        # (3) 응급실/중증 메시지 (외부 API 5xx 등은 무시하고 계속 진행)
        try:
            messages = ermct_client.get_emergency_messages(
                hpid=hpid,
                num_rows=50,
                page_no=1,
            )
        except Exception as e:
            print(f"[WARN] get_emergency_messages failed for {hpid}: {e}")
            messages = []

        # (4) 이름 결정 (basic → realtime → messages 순)
        name: Optional[str] = None
        if basic and basic.name:
            name = basic.name
        elif r.name:
            name = r.name
        elif messages:
            first_msg = messages[0]
            msg_name = getattr(first_msg, "name", None)
            if msg_name:
                name = msg_name

        summary = HospitalSummary(
            id=hpid,
            name=name,
            basic=basic,
            realtime=r,
            serious=serious,
            messages=messages,
            is_trauma_center=(hpid in trauma_hpids),
        )

        summary.procedure_availability = compute_procedure_availability(summary)

        results.append(summary)

    return results


# --------------------------------------------------------------------
# 6) 병원 필터링 (2학기 대비 1단계에서 지역을 받는 버전)
# --------------------------------------------------------------------
@app.post("/api/triage/recommend", response_model=list[RecommendedHospital])
def recommend_hospitals(triage: TriageRequest = Body(...)):
    """
    환자 정보(KTAS, 주호소 증상, 원내/기존 병원)를 입력받아
    - 해당 지역(sido, sigungu)의 병원 요약을 가져오고
    - 주호소 증상에 맞는 procedure group들을 계산한 뒤
    - 수술 가능 + 병상 남아있는 병원만 필터링해서 추천 리스트를 반환
    """
    # 1) 지역 정보는 이제 요청에서 직접 받음
    sido = triage.sido
    sigungu = triage.sigungu

    # 2) 이 complaint가 요구하는 procedure group 목록
    required_groups = required_procedure_groups_for_complaint(triage.complaint_id)
    if not required_groups:
        # 정의 안 된 complaint면 빈 리스트 반환 (혹은 400 에러로 바꿔도 됨)
        return []

    # 3) 해당 지역 병원 요약 가져오기
    #    이미 위에서 정의한 get_hospital_summaries_by_region() 함수를 그대로 재사용
    summaries: List[HospitalSummary] = get_hospital_summaries_by_region(
        sido=sido,
        sigungu=sigungu,
        sm_type=1,
        num_rows=200,
    )

    candidates: List[RecommendedHospital] = []

    for s in summaries:
        # 4) 이 병원이 해당 procedure group들에 대해
        #    수용 가능 + 병상 몇 개 있는지 계산
        proc_status = procedure_status_for_hospital(s, required_groups)
        # proc_status: {group_id: {"api_beds": int, "effective_beds": int}}

        # effective_beds > 0 인 그룹만 따로 추출
        groups_with_beds = [
            gid
            for gid, info in proc_status.items()
            if info.get("effective_beds", 0) > 0
        ]

        # 시술 자체가 전부 불가능하면 스킵
        if not groups_with_beds:
            continue

        # complaint 전체 기준 병상 수는 bed_type 합집합으로 계산
        if s.realtime:
            _, total_eff, _ = get_effective_beds_for_groups(
                hpid=s.id,
                realtime=s.realtime,
                group_ids=groups_with_beds,
            )
        else:
            total_eff = 0

        # 5) 수용 가능하지만 병상이 0이면 필터링
        if total_eff <= 0:
            continue

        # coverage_score / coverage_level 계산
        coverage_score, coverage_level = _compute_coverage_score_and_level(
            required_groups=required_groups,
            groups_with_beds=groups_with_beds,
        )

        # 6) RecommendedHospital 엔티티로 변환
        candidates.append(
            RecommendedHospital(
                id=s.id,
                name=s.name or (s.basic.name if s.basic else s.id),
                ktas=triage.ktas,
                complaint_id=triage.complaint_id,
                total_effective_beds=total_eff,
                procedure_beds=proc_status,
                basic=s.basic,
                realtime=s.realtime,
                serious=s.serious,
                messages=s.messages or [],
                coverage_score=coverage_score,
                coverage_level=coverage_level,
            )
        )

    # 7) 정렬: 거리 안 쓰고,
    #    - home_hpid(기존 다니던 병원) 우선
    #    - 그 다음 병상 많은 순
    home_hpid = triage.home_hpid

    def sort_key(h: RecommendedHospital):
        is_home = 1 if (home_hpid and h.id == home_hpid) else 0
        return (-is_home, -h.total_effective_beds)

    candidates.sort(key=sort_key)

    return candidates


# --------------------------------------------------------------------
# 7) 중증 외상센터 정보
# --------------------------------------------------------------------
@app.get("/api/hospitals/trauma/by-region", response_model=List[TraumaCenter])
def get_trauma_by_region(
    sido: str,
    sigungu: str,
    num_rows: int = 50,
):
    return ermct_client.get_trauma_centers(
        sido=sido,
        sigungu=sigungu,
        num_rows=num_rows,
        page_no=1,
    )


# --------------------------------------------------------------------
# 8) 지역 기준 증상 출력 (디버그용)
# --------------------------------------------------------------------
@app.get(
    "/api/hospitals/complaint-coverage/by-region",
    response_model=list[HospitalComplaintCoverage],
)
def get_complaint_coverage_by_region(
    sido: str = Query(..., description="시도명 (예: 서울특별시)"),
    sigungu: str = Query(..., description="시군구명 (예: 강남구)"),
    sm_type: int = Query(
        1,
        description="중증질환 분류 타입(SM_TYPE), 가이드 기본값 1",
    ),
    num_rows: int = Query(
        200,
        ge=1,
        le=500,
        description="실시간 병상 조회 시 한 번에 가져올 최대 병원 수",
    ),
):
    """
    특정 시/군/구 내 모든 병원에 대해
    - MKioskTy 기반으로
    - 이 병원이 어떤 complaint(1~10)를 커버하는지 미리 계산해서 내려주는 디버깅용 API.
    """

    # 기존 요약 API 로직을 재사용
    summaries: List[HospitalSummary] = get_hospital_summaries_by_region(
        sido=sido,
        sigungu=sigungu,
        sm_type=sm_type,
        num_rows=num_rows,
    )

    results: List[HospitalComplaintCoverage] = []

    for s in summaries:
        supported = complaints_supported_by_hospital(s)  # Set[int]
        # 정렬해서 내려주자
        supported_ids = sorted(list(supported))

        labels = [COMPLAINT_LABELS[cid] for cid in supported_ids if cid in COMPLAINT_LABELS]

        results.append(
            HospitalComplaintCoverage(
                id=s.id,
                name=s.name
                or (s.basic.name if s.basic else None)
                or s.id,
                supported_complaints=supported_ids,
                supported_complaint_labels=labels,
            )
        )

    return results

# --------------------------------------------------------------------
# 9) 증상 기준 병원 출력 (디버그용)
# --------------------------------------------------------------------
@app.post(
    "/api/triage/candidates",
    response_model=RoutingCandidateResponse,
)
def get_routing_candidates(triage: TriageRequest = Body(...)):
    """
    '가능 수술 기준' 후보 병원 리스트를 반환하는 엔드포인트.

    - 상세 과정:
      * 해당 지역(sido, sigungu)의 병원들 중
      * complaint_id에 맞는 procedure group을 수용 가능하고
      * 그 procedure에 대해 effective_beds > 0 인 병원만 골라서
      * 위치/연락처 + 근거 정보와 함께 리스트로 넘겨준다.
    """

    # 1) 이 complaint가 요구하는 procedure group 목록
    required_groups = required_procedure_groups_for_complaint(triage.complaint_id)
    if not required_groups:
        # 정의 안 된 complaint면 빈 리스트
        return RoutingCandidateResponse(
            hid=triage.home_hpid or None,
            hospitals=[],
        )

    # 2) 지역 내 병원 summary들 불러오기
    summaries: List[HospitalSummary] = get_hospital_summaries_by_region(
        sido=triage.sido,
        sigungu=triage.sigungu,
        sm_type=1,
        num_rows=200,
    )

    candidates: List[RoutingCandidateHospital] = []
    home_hpid = triage.home_hpid
    complaint_label = COMPLAINT_LABELS.get(
        triage.complaint_id,
        f"Complaint {triage.complaint_id}",
    )

    for s in summaries:
        basic = s.basic
        if not basic:
            continue

        lat = basic.latitude
        lon = basic.longitude
        if lat is None or lon is None:
            # 위치정보 없는 병원은 T-MAP에서 쓸 수 없으니 제외
            continue

        # 응급실 있는 병원만
        duty_eryn = basic.raw_fields.get("dutyEryn") if basic.raw_fields else None
        if duty_eryn != "1":
            continue

        # 3) 이 병원이 required_groups에 대해 얼마나 수용 가능한지 계산
        proc_status = procedure_status_for_hospital(s, required_groups)
        if not proc_status:
            continue

        # effective_beds > 0 인 그룹만 뽑기
        groups_with_beds = [
            gid
            for gid, info in proc_status.items()
            if info.get("effective_beds", 0) > 0
        ]

        # 하나도 병상이 없는 병원은 후보에서 제외
        if not groups_with_beds:
            continue

        # 🔹 complaint 전체 기준 병상 수 = bed_type 합집합으로 계산
        if s.realtime:
            _, total_eff, _ = get_effective_beds_for_groups(
                hpid=s.id,
                realtime=s.realtime,
                group_ids=groups_with_beds,
            )
        else:
            total_eff = 0

        if total_eff <= 0:
            continue

        coverage_score, coverage_level = _compute_coverage_score_and_level(
            required_groups=required_groups,
            groups_with_beds=groups_with_beds,
        )

        has_any_bed = True  # 위에서 이미 필터링함

        # 코드 → 라벨 변환
        required_group_labels = humanize_procedure_groups(required_groups)
        groups_with_beds_labels = humanize_procedure_groups(groups_with_beds)

        # 4) MKioskTy 기준 이 병원이 커버 가능한 complaint들 계산
        supported_complaints = sorted(list(complaints_supported_by_hospital(s)))
        supported_labels = [
            COMPLAINT_LABELS[cid]
            for cid in supported_complaints
            if cid in COMPLAINT_LABELS
        ]

        # 5) MKioskTy Y 플래그 수집
        mkiosk_flags: List[str] = []
        if s.serious and s.serious.mkiosk:
            mkiosk_flags.extend(
                [
                    k
                    for k, v in s.serious.mkiosk.items()
                    if v and str(v).upper().startswith("Y")
                ]
            )
        if basic.raw_fields:
            for k, v in basic.raw_fields.items():
                if not k.startswith("MKioskTy"):
                    continue
                if v and str(v).upper().startswith("Y") and k not in mkiosk_flags:
                    mkiosk_flags.append(k)

        # 6) home_hpid 여부 + 내부 priority_score
        is_home = bool(home_hpid and s.id == home_hpid)
        base_score = float(total_eff + (100 if is_home else 0))
        priority_score = _apply_coverage_weight(
            base_score=base_score,
            coverage_level=coverage_level,
            coverage_score=coverage_score,
        )

        # 7) 사람이 읽기 좋은 reason_summary (coverage 포함)
        reason = _build_reason_summary_with_coverage(
            ktas=triage.ktas,
            complaint_label=complaint_label,
            groups_with_beds_labels=groups_with_beds_labels,
            groups_with_beds=groups_with_beds,
            total_eff=total_eff,
            coverage_level=coverage_level,
            coverage_score=coverage_score,
        )

        # 8) RoutingCandidateHospital로 변환
        candidates.append(
            RoutingCandidateHospital(
                id=s.id,
                name=s.name or (basic.name if basic.name else s.id),
                address=basic.address,
                phone=basic.phone,
                emergency_phone=basic.emergency_phone,
                latitude=lat,
                longitude=lon,
                ktas=triage.ktas,
                complaint_id=triage.complaint_id,
                complaint_label=complaint_label,
                required_procedure_groups=required_groups,
                required_procedure_group_labels=required_group_labels,
                procedure_beds=proc_status,
                total_effective_beds=total_eff,
                has_any_bed=has_any_bed,
                groups_with_beds=groups_with_beds,
                groups_with_beds_labels=groups_with_beds_labels,
                supported_complaints=supported_complaints,
                supported_complaint_labels=supported_labels,
                mkiosk_flags=mkiosk_flags,
                coverage_score=coverage_score,
                coverage_level=coverage_level,
                priority_score=priority_score,
                reason_summary=reason,
            )
        )

    # 9) 정렬: coverage까지 반영된 priority_score 우선
    def sort_key(c: RoutingCandidateHospital):
        return (-c.priority_score, -c.total_effective_beds)

    candidates.sort(key=sort_key)

    return RoutingCandidateResponse(
        hid=home_hpid or None,
        hospitals=candidates,
    )


# --------------------------------------------------------------------
# 10) 지역내 raw 병상 정보 출력 (디버그용)
# --------------------------------------------------------------------
@app.get(
    "/api/hospitals/procedure-beds/by-region",
    response_model=List[HospitalProcedureBeds],
)
def get_procedure_beds_by_region(
    sido: str,
    sigungu: str,
    complaint_id: Optional[int] = None,
):
    """
    디버그용:
    - 특정 시/군/구 내 병원들에 대해
    - 주증상(complaint_id)에 해당하는 procedure group 기준으로
      병상 상태를 그대로 보여주는 엔드포인트.

    complaint_id가 없으면 모든 PROCEDURE_GROUPS에 대해 병상 계산.
    """

    # 1) 평가 대상 procedure group 결정
    if complaint_id is not None:
        groups = required_procedure_groups_for_complaint(complaint_id)
        complaint_label = COMPLAINT_LABELS.get(
            complaint_id,
            f"Complaint {complaint_id}",
        )
    else:
        groups = list(PROCEDURE_GROUPS.keys())
        complaint_label = None

    # 2) 지역별 병원 요약 불러오기
    summaries: List[HospitalSummary] = get_hospital_summaries_by_region(
        sido=sido,
        sigungu=sigungu,
        sm_type=1,
        num_rows=200,
    )

    results: List[HospitalProcedureBeds] = []

    for s in summaries:
        # 1) procedure group 병상 계산
        proc_status = procedure_status_for_hospital(s, groups)

        # 2) 응급실 일반 병상(hvec / er_beds)
        er_beds = 0
        if s.realtime and s.realtime.er_beds is not None:
            er_beds = s.realtime.er_beds

        # 3) 병상 있음 여부는 ER 기준
        has_any_bed = er_beds > 0

        basic = s.basic
        name = s.name
        if not name and basic and basic.name:
            name = basic.name

        results.append(
            HospitalProcedureBeds(
                id=s.id,
                name=name or s.id,
                complaint_id=complaint_id,
                complaint_label=complaint_label,
                required_procedure_groups=groups,
                procedure_beds=proc_status,
                er_beds=er_beds,
                has_any_bed=has_any_bed,
            )
        )

    # 병상 있는 병원 먼저 보이도록 er_beds 기준으로 정렬
    results.sort(
        key=lambda r: (-int(r.has_any_bed), -r.er_beds, r.id)
    )

    return results

# --------------------------------------------------------------------
# 10) 병상 예약 (프론트 소통용)
# --------------------------------------------------------------------
# --------------------------------------------------------------------
# 13) 1단계 입력 기준 서울시 내 병원 필터링 (최종) 
# --------------------------------------------------------------------
@app.post(
    "/api/ktas/route/seoul",
    response_model=RoutingCandidateResponse,
)
def route_from_ktas_seoul(req: KTASRoutingRequest = Body(...)):
    """
    KTAS 모듈에서 넘겨준 결과를 바탕으로
    - 서울특별시 전체 병원 중
    - chief_complaint에 해당하는 complaint_id(1~10)를 커버하고
    - 해당 procedure group 기준 effective_beds > 0 인 병원만
      RoutingCandidateHospital 리스트로 반환.
    """

    # 1) chief_complaint → complaint_id
    complaint_id = complaint_id_from_chief_complaint(req.chief_complaint)
    if not complaint_id:
        raise HTTPException(
            status_code=400,
            detail=f"알 수 없는 chief_complaint: {req.chief_complaint}",
        )

    required_groups = required_procedure_groups_for_complaint(complaint_id)
    if not required_groups:
        raise HTTPException(
            status_code=400,
            detail=f"complaint_id {complaint_id}에 매핑된 procedure group이 없습니다.",
        )

    complaint_label = COMPLAINT_LABELS.get(
        complaint_id,
        f"Complaint {complaint_id}",
    )

    routing_case = RoutingCase(
        ktas=req.ktas_level,
        complaint_id=complaint_id,
        complaint_label=complaint_label,
        required_procedure_groups=required_groups,
        required_procedure_group_labels=humanize_procedure_groups(required_groups),
    )

    candidates: List[RoutingCandidateHospital] = []
    progressive_result: Optional[ProgressiveSearchResult[RoutingCandidateHospital]] = None
    current_sigungu_code, current_sido_name = _resolve_current_region(req)

    print(
        "[ROUTE SEOUL] "
        f"chief_complaint={req.chief_complaint} "
        f"user_lat={req.user_lat!r} "
        f"user_lon={req.user_lon!r} "
        f"current_sigungu_name={req.current_sigungu_name!r} "
        f"resolved_sigungu_code={current_sigungu_code!r} "
        f"resolved_sido_name={current_sido_name!r}"
    )

    if current_sigungu_code:
        candidates, progressive_result = _search_routing_candidates_progressively(
            req=req,
            complaint_id=complaint_id,
            required_groups=required_groups,
            complaint_label=complaint_label,
            base_sigungu_code=current_sigungu_code,
            base_sido_name=current_sido_name,
        )

    should_run_global_fallback = (
        progressive_result is None
        or len(candidates) < req.min_valid_hospitals
        or any(
            attempt.fetch_status == "error"
            for attempt in (progressive_result.attempts if progressive_result else [])
        )
    )

    if len(candidates) < req.min_valid_hospitals and should_run_global_fallback:
        print(
            "[ROUTE SEOUL] running global fallback "
            f"candidate_count={len(candidates)} "
            f"min_valid_hospitals={req.min_valid_hospitals}"
        )
        summaries = _get_all_indexed_summaries(sm_type=1)
        candidates = _build_routing_candidates_from_summaries(
            req=req,
            complaint_id=complaint_id,
            required_groups=required_groups,
            complaint_label=complaint_label,
            summaries=summaries,
        )

    followup_id = None
    if req.hospital_followup:
        if req.hospital_followup.startswith("A") and req.hospital_followup[1:].isdigit():
            followup_id = req.hospital_followup
        else:
            followup_id = _resolve_home_hpid_from_followup(
                summaries=_get_all_indexed_summaries(sm_type=1),
                hospital_followup=req.hospital_followup,
            )

    if progressive_result:
        for attempt in progressive_result.attempts:
            print(
                f"[SIGUNGU SEARCH] level={attempt.level} code={attempt.sigungu_code} "
                f"name={attempt.sigungu_name} status={attempt.fetch_status} "
                f"raw_count={attempt.raw_count} "
                f"candidate_count={attempt.fetched_count} valid_total={attempt.valid_count}"
            )

    return RoutingCandidateResponse(
        followup_id=followup_id,
        case=routing_case,
        hospitals=candidates,
    )

@app.post(
    "/api/ktas/route/seoul/nearest",
    response_model=RoutingCandidateResponse,
)
async def route_seoul_nearest(
    req: NearestRoutingRequest = Body(...)
):
    """
    1단계 라우팅 결과(서울 전체 후보들) + 사용자 위치를 받아,
    Tmap 거리 기준 상위 3개 병원만 골라 distance/duration_sec을 채워서 반환.
    """

    # 1) distance_logic에 줄 payload 구성
    hospitals_payload = [
        {
            "name": h.name,
            "latitude": h.latitude,
            "longitude": h.longitude,
            "reason_summary": h.reason_summary,
        }
        for h in req.hospitals
    ]

    # 2) Tmap API로 모든 후보 병원까지 거리/시간 계산
    results = await calculate_all_distances_async(
        user_lat=req.user_lat,
        user_lon=req.user_lon,
        hospitals=hospitals_payload,
    )
    print(
        "[ROUTE NEAREST] "
        f"input_hospitals={len(req.hospitals)} distance_results={len(results)}"
    )

    # 3) 거리 기준 상위 3개만 선택
    top3_results = get_top3(results)

    # 4) name 기준으로 매핑 (이름이 중복될 가능성이 낮다고 가정)
    result_by_name = {r["name"]: r for r in top3_results}

    top3_hospitals: List[RoutingCandidateHospital] = []

    for h in req.hospitals:
        r = result_by_name.get(h.name)
        if not r:
            continue

        # 기존 필드는 그대로 두고 distance, duration만 덧입힘
        data = h.model_dump()
        data["distance"] = float(r["distance"])
        data["duration_sec"] = int(r["duration_sec"])

        top3_hospitals.append(RoutingCandidateHospital(**data))

    # 5) followup_id는 그대로 유지, 병원 리스트만 top3로 교체
    return RoutingCandidateResponse(
        followup_id=req.followup_id,
        case=req.case,
        user_lat=req.user_lat,
        user_lon=req.user_lon,
        hospitals=top3_hospitals,
    )


@app.post(
    "/api/ktas/route/path",
    response_model=RoutePathResponse,
)
async def get_route_path(req: RoutePathRequest = Body(...)):
    route = await get_tmap_route_async(
        start_lat=req.start_lat,
        start_lon=req.start_lon,
        end_lat=req.end_lat,
        end_lon=req.end_lon,
    )

    if not route:
        raise HTTPException(status_code=502, detail="Tmap route calculation failed")

    return RoutePathResponse(
        path=[RoutePathPoint(**point) for point in route["path"]],
        distance=float(route["distance"]),
        duration_sec=int(route["duration_sec"]),
    )


# 파일 맨 끝에 붙여넣으세요

@app.post("/api/ktas/predict-audio", response_model=RoutingCandidateResponse)
async def predict_audio(audio: UploadFile = File(...)):
    """
    [Stage 1 + Stage 2 통합]
    """
    # 1. [Stage 1] 음성 엔진 실행
    print("\n[Stage 1] 음성 분석 및 KTAS 분류 중...")
    stage1_result = ktas_from_audio(audio.file)
    return _build_stage1_response(stage1_result)

    # 2. 데이터 변환
    payload_dict = build_stage2_payload(stage1_result)
    req_obj = KTASRoutingRequest(**payload_dict)

    # 3. [Stage 2] 병원 추천 로직 실행 (변수에 담기!)
    print("[Stage 2] 병원 필터링 및 순위 선정 중...")
    
    # ★ 여기서 바로 return 하지 말고, 변수(final_response)에 저장합니다.
    final_response = route_from_ktas_seoul(req_obj) 

    # ====================================================
    # ★ 터미널 출력용 코드 (여기서 확인!)
    # ====================================================
    print("\n" + "="*60)
    print(f" 🚑 [최종 추천 결과] 총 {len(final_response.hospitals)}개 병원 발견")
    print("="*60)

    # 상위 3개 병원만 터미널에 찍어보기
    for i, hosp in enumerate(final_response.hospitals[:3]):
        print(f" {i+1}순위: {hosp.name}")
        print(f"    - 병상수: {hosp.total_effective_beds}개")
        print(f"    - 추천사유: {hosp.reason_summary}")
        print("-" * 40)
    
    print("="*60 + "\n")
    # ====================================================

    # 4. STT vitals를 응답에 포함해서 리턴
    result_dict = final_response.model_dump()
    stt_vitals = stage1_result.get("sbar", {}).get("A", {}) if isinstance(stage1_result, dict) else {}
    result_dict["stt_vitals"] = stt_vitals
    return RoutingCandidateResponse(**result_dict)


@app.post("/api/ktas/predict-text", response_model=RoutingCandidateResponse)
async def predict_text(req: TextKTASRequest = Body(...)):
    """
    음성 대신 텍스트 보고서를 받아 KTAS를 산출하고 병원 추천을 반환.
    음성 파이프라인과 동일한 decide_ktas_1to3 로직을 사용.
    """
    print("\n[Stage 1] 텍스트 분석 및 KTAS 분류 중...")
    stage1_result = ktas_from_text(req.text, use_rag=True)
    return _build_stage1_response(stage1_result)

    payload_dict = build_stage2_payload(stage1_result)
    req_obj = KTASRoutingRequest(**payload_dict)

    print("[Stage 2] 병원 필터링 및 순위 선정 중...")
    final_response = route_from_ktas_seoul(req_obj)

    result_dict = final_response.model_dump()
    text_vitals = stage1_result.get("sbar", {}).get("A", {}) if isinstance(stage1_result, dict) else {}
    result_dict["stt_vitals"] = text_vitals  # 프론트 재사용을 위해 동일 키
    return RoutingCandidateResponse(**result_dict)
