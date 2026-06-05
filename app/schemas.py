# app/schemas.py
from __future__ import annotations

from typing import Optional, Dict, Any, List

from pydantic import BaseModel, Field


class HospitalRealtime(BaseModel):
    # -------------------
    # 기본 식별 정보
    # -------------------
    id: str                         # hpid
    name: str                       # dutyName
    phone: Optional[str] = None     # dutyTel3

    # 메타
    rnum: Optional[int] = None          # rnum
    old_id: Optional[str] = None        # phpid
    input_datetime: Optional[str] = None  # hvidate (YYYYMMDDHHMMSS 문자열)

    # -------------------
    # 병상 요약 정보
    # -------------------
    er_beds: Optional[int] = None           # hvec  (응급실)
    or_beds: Optional[int] = None           # hvoc  (수술실)
    neuro_icu_beds: Optional[int] = None    # hvcc  (신경중환자, 실제 응답에 없을 수도 있음)
    neonatal_icu_beds: Optional[int] = None # hvncc (신생중환자)
    thoracic_icu_beds: Optional[int] = None # hvccc (흉부중환자)
    general_icu_beds: Optional[int] = None  # hvicc (일반중환자)
    ward_beds: Optional[int] = None         # hvgc  (입원실)

    # -------------------
    # 장비 / 자원 가용 여부 (Y/N 계열)
    # -------------------
    ct_available: Optional[bool] = None                  # hvctayn
    mri_available: Optional[bool] = None                 # hvmriayn
    angio_available: Optional[bool] = None               # hvangioayn
    ventilator_available: Optional[bool] = None          # hvventiayn
    ventilator_premature_available: Optional[bool] = None  # hvventisoayn
    incubator_available: Optional[bool] = None           # hvincuayn
    crrt_available: Optional[bool] = None                # hvcrrtayn
    ecmo_available: Optional[bool] = None                # hvecmoayn
    hyperbaric_oxygen_available: Optional[bool] = None   # hvoxyayn
    hypothermia_available: Optional[bool] = None         # hvhypoayn
    ambulance_available: Optional[bool] = None           # hvamyn

    # -------------------
    # 소아 / 특수 플래그 (Y/N 값들)
    # -------------------
    pediatric_ventilator_flag: Optional[bool] = None  # hv10 (VENTI(소아))
    incubator_flag: Optional[bool] = None             # hv11 (인큐베이터(보육기))

    neuro_ward_flag: Optional[bool] = None            # hv5  (신경과 입원실 관련, Y/N)
    toxic_icu_flag: Optional[bool] = None             # hv7  (약물중환자 관련, Y/N)
    pediatric_icu_flag: Optional[bool] = None         # hv42 (소아중환자실 관련, Y/N)

    # -------------------
    # hv* / hvs* 전체 숫자값 보관
    # -------------------
    # hvXX 중에서 실제로 숫자로 해석되는 것만 모음 (응급실 세부 병상 등)
    raw_hv: Dict[str, Optional[int]] = Field(default_factory=dict)

    # HVSXX (기준 병상 수)
    baseline_hvs: Dict[str, Optional[int]] = Field(default_factory=dict)

    # -------------------
    # 원본 태그 전체 (문자열 그대로)
    # -------------------
    # XML <item> 안의 모든 태그/값을 문자열로 저장 (이미 매핑한 필드도 포함)
    raw_fields: Dict[str, Any] = Field(default_factory=dict)

    class Config:
        extra = "ignore"


class HospitalBasicInfo(BaseModel):
    """getEgytBassInfoInqire 응답 래핑"""

    id: str                                # hpid / emcOrgCod
    name: Optional[str] = None             # dutyName
    address: Optional[str] = None          # dutyAddr
    phone: Optional[str] = None            # 대표 전화 (dutyTel1 등)
    emergency_phone: Optional[str] = None  # 응급실 전화 (dutyTel3)
    latitude: Optional[float] = None       # 위도
    longitude: Optional[float] = None      # 경도
    start_time: Optional[str] = None       # 진료 시작시간 (필요 시)
    end_time: Optional[str] = None         # 진료 종료시간 (필요 시)
    rnum: Optional[int] = None             # 일련번호 (있으면)

    # 문서에 있는 나머지 모든 필드 그대로 저장
    raw_fields: Dict[str, Any] = Field(default_factory=dict)


class SeriousDiseaseStatus(BaseModel):
    """getSrsillDissAceptncPosblInfoInqire 응답 래핑"""
    id: str | None = None
    name: Optional[str] = None  # dutyName (실제 응답 돌려보고 병원명/코드 확인)
    # MKioskTy1~26 상태값
    mkiosk: Dict[str, Optional[str]] = Field(default_factory=dict)
    # MKioskTyXXMsg 계열 메시지
    mkiosk_msg: Dict[str, Optional[str]] = Field(default_factory=dict)

    # dutyName 같은 나머지 값들
    raw_fields: Dict[str, Any] = Field(default_factory=dict)


class HospitalMessage(BaseModel):
    """getEmrrmSrsillDissMsgInqire 응답 래핑"""

    id: str                                # hpid
    name: Optional[str] = None             # dutyName
    address: Optional[str] = None          # dutyAddr
    emc_org_code: Optional[str] = None     # emcOrgCod
    rnum: Optional[int] = None

    message: Optional[str] = None          # symBlkMsg (장비부족 등)
    message_type: Optional[str] = None     # symBlkMsgTyp (중증/응급 등)
    message_type_code: Optional[str] = None  # symTypCod (Y000 등)
    message_type_name: Optional[str] = None  # symTypCodMag (응급실 등)

    out_display_method: Optional[str] = None  # symOutDspMth (자동/수동)
    out_display_status: Optional[str] = None  # symOutDspYon (차단/해제)
    block_start: Optional[str] = None         # symBlkSttDtm
    block_end: Optional[str] = None           # symBlkEndDtm

    raw_fields: Dict[str, Any] = Field(default_factory=dict)


class HospitalSummary(BaseModel):
    """
    단일 병원(HPID)에 대한 통합 요약 정보

    - id: HPID (예: A1100010)
    - name: 병원 이름 (기본정보/실시간/메시지 중 가장 먼저 찾은 값)
    - basic: 응급의료기관 기본정보
    - realtime: 실시간 응급실/중환자/병상/장비 가용 정보
    - serious: 중증질환 수용 가능 정보 (MKioskTyXX, MKioskTyXXMsg)
    - messages: 응급실/중증 관련 메시지 리스트
    """

    id: str
    name: Optional[str] = None

    basic: Optional[HospitalBasicInfo] = None
    realtime: Optional[HospitalRealtime] = None
    serious: Optional[SeriousDiseaseStatus] = None

    is_trauma_center: bool = False

    messages: List[HospitalMessage] = []

    procedure_availability: Dict[str, ProcedureAvailability] = Field(
        default_factory=dict
    )


from typing import Literal

class TriageRequest(BaseModel):
    """
    프리호스피탈 단계에서 들어오는 triage 요청 정보

    - ktas: 1~3 위주로 올 예정이지만, 형식상 1~5까지 허용
    - complaint_id: 1~10 (가슴통증, 호흡곤란, 신경학, 복통/소화기, 출혈, 의식변화,
                         외상, 산부인과, 소아, 정신과)
    - sido/sigungu: 어떤 지역 병원 풀을 볼지
    - home_hpid: 기존 다니던 병원 / 원내 지정 병원 (있으면 우선 정렬에 반영)
    - note: 구급대원 자유 서술 (지금 단계에서는 로직에 안 써도 됨)
    """
    ktas: int = Field(..., ge=1, le=5, description="KTAS 등급 (1~5)")
    complaint_id: int = Field(..., ge=1, le=10, description="주호소 증상 카테고리 ID (1~10)")

    sido: str = Field(..., description="광역시/도 (예: '서울특별시')")
    sigungu: str = Field(..., description="시/군/구 (예: '노원구')")

    home_hpid: Optional[str] = Field(
        default=None,
        description="기존 다니던 병원 / 원내 지정 병원 HPID (있다면 우선순위에 반영)"
    )
    note: Optional[str] = Field(
        default=None,
        description="구급대원 소견 / 추가 메모"
    )


class RecommendedHospital(BaseModel):
    """
    triage 결과로 내려주는 병원 추천 결과 1개

    - 거리 정보는 이번 버전에서 사용하지 않으므로 포함 안 함
    - total_effective_beds: 이 환자 complaint에 필요한 procedure group들의
                            effective_beds 합
    - procedure_beds: group_id -> {api_beds, effective_beds}
                      (triage_utils.procedure_status_for_hospital() 반환 형식 그대로)
    """

    id: str
    name: str

    ktas: int
    complaint_id: int

    total_effective_beds: int = Field(
        ...,
        description="이 환자에 대해 고려한 모든 procedure group의 effective_beds 합"
    )

    procedure_beds: Dict[str, Dict[str, int]] = Field(
        default_factory=dict,
        description="각 procedure group별 bed 상태 (api_beds, effective_beds)"
    )

    # 요약정보들
    basic: Optional["HospitalBasicInfo"] = None
    realtime: Optional["HospitalRealtime"] = None
    serious: Optional["SeriousDiseaseStatus"] = None
    messages: List["HospitalMessage"] = Field(default_factory=list)

    coverage_score: float = Field(
        0.0,
        description="required_procedure_groups 중 실제로 bed가 있는 그룹 비율 (0.0~1.0)"
    )
    coverage_level: Literal["FULL", "HIGH", "MEDIUM", "LOW", "NONE"] = Field(
        "NONE",
        description="coverage_score를 구간으로 나눈 등급"
    )


class ProcedureAvailability(BaseModel):
    """각 수술/시술 그룹별 가능 여부 요약"""

    label: str                  # 사람이 읽기 좋은 이름 (예: [재관류중재술] 심근경색)
    status: str                 # "가능" / "불가능" / "정보미제공"
    source: str                 # serious / basic / none / serious+message 등 디버그용


class TraumaCenter(BaseModel):
    id: str                      # hpid
    name: Optional[str] = None   # dutyName
    address: Optional[str] = None  # dutyAddr
    emc_class_code: Optional[str] = None   # dutyEmcls
    emc_class_name: Optional[str] = None   # dutyEmclsName
    tel: Optional[str] = None    # dutyTel1
    er_tel: Optional[str] = None # dutyTel3
    lat: Optional[float] = None  # wgs84Lat
    lon: Optional[float] = None  # wgs84Lon
    raw_fields: Dict[str, Any] = {}


class HospitalComplaintCoverage(BaseModel):
    """
    로그/디버깅용:
    한 병원이 어떤 주호소 complaint(1~10)를
    capability 기준으로 커버할 수 있는지 기록하는 모델
    """

    id: str                       # hpid
    name: Optional[str] = None    # 병원 이름 (basic/realtime에서 가져온 값)

    supported_complaints: List[int] = Field(
        default_factory=list,
        description="이 병원이 커버 가능한 complaint ID 목록 (1~10)",
    )

    supported_complaint_labels: List[str] = Field(
        default_factory=list,
        description="사람이 읽기 좋은 complaint 라벨 문자열",
    )


class HospitalProcedureBeds(BaseModel):
    """
    디버그용: 병원별로 수술 그룹별 병상 상태를 한 눈에 보기 위한 스키마
    """
    id: str
    name: Optional[str] = None

    complaint_id: Optional[int] = None
    complaint_label: Optional[str] = None

    # 이 병원에 대해 평가한 procedure group 목록
    required_procedure_groups: List[str] = Field(default_factory=list)

    # group_id -> {"api_beds": X, "effective_beds": Y}
    procedure_beds: Dict[str, Dict[str, int]] = Field(default_factory=dict)

    # 응급실 일반 병상(hvec / er_beds 기준)
    er_beds: int = 0

    # 예전 로직(모든 procedure 그룹 effective_beds 합): 참고용으로만 둠
    has_any_bed: bool


class BedReservationRequest(BaseModel):
    """
    구급대원이 특정 병원에 '이 complaint 환자'를 보낸다고 예약할 때 쓰는 요청 스키마.
    """
    hpid: str
    complaint_id: int
    ktas: int
    num_patients: int = 1  # 한 번에 여러 명 예약해도 되게 기본값 1


class BedReleaseRequest(BaseModel):
    """
    예약 취소 / 환자 도착 실패 등으로 병상을 되돌릴 때 쓰는 요청 스키마.
    """
    hpid: str
    complaint_id: int
    num_patients: int = 1

class KTASRoutingRequest(BaseModel):
    ktas_level: int
    chief_complaint: str
    hospital_followup: Optional[str] = None
    current_sigungu_code: Optional[str] = Field(
        default=None,
        description="사용자 현재 시군구 코드. 주어지면 adjacency 기반 점진 탐색의 시작점으로 사용",
    )
    current_sigungu_name: Optional[str] = Field(
        default=None,
        description="사용자 현재 시군구명. 코드가 없을 때 코드 해석용으로 사용",
    )
    user_lat: Optional[float] = Field(
        default=None,
        description="사용자 위도. 현재는 저장만 하며, 이후 실제 거리 기반 정렬 확장용",
    )
    user_lon: Optional[float] = Field(
        default=None,
        description="사용자 경도. 현재는 저장만 하며, 이후 실제 거리 기반 정렬 확장용",
    )
    min_valid_hospitals: int = Field(
        default=3,
        ge=1,
        le=20,
        description="점진 탐색 종료 기준이 되는 최소 유효 병원 수",
    )

class ProcedureBedInfo(BaseModel):
    api_beds: int
    effective_beds: int


class RoutingCase(BaseModel):
    ktas: int
    complaint_id: int
    complaint_label: str

    required_procedure_groups: List[str]
    required_procedure_group_labels: List[str]


class RoutingCandidateHospital(BaseModel):
    id: str
    name: str
    address: str
    phone: Optional[str]
    emergency_phone: Optional[str]
    latitude: float
    longitude: float

    procedure_beds: Dict[str, Dict[str, int]]
    total_effective_beds: int
    has_any_bed: bool

    groups_with_beds: List[str]

    groups_with_beds_labels: List[str]

    supported_complaints: List[int]
    supported_complaint_labels: List[str]

    mkiosk_flags: List[str]

    coverage_score: float = Field(
        0.0,
        description="required_procedure_groups 중 groups_with_beds에 포함된 비율 (0.0~1.0)"
    )
    coverage_level: Literal["FULL", "HIGH", "MEDIUM", "LOW", "NONE"] = Field(
        "NONE",
        description="coverage_score를 구간별로 나눈 등급"
    )

    priority_score: float
    reason_summary: str

    # 거리 필드 - 3단계용
    distance: Optional[float] = Field(
        None,
        description="사용자 위치에서 병원까지 도로 기준 거리(m, Tmap 결과)",
    )
    duration_sec: Optional[int] = Field(
        None,
        description="예상 이동 시간(초, Tmap 결과)",
    )


class RoutingCandidateResponse(BaseModel):
    followup_id: Optional[str]  # 평소 다니던 병원 HPID (없으면 null)
    case: RoutingCase
    hospitals: List[RoutingCandidateHospital]
    stt_vitals: Optional[Dict[str, Any]] = Field(
        default=None,
        description="음성 인식(STT)에서 추출된 활력징후/AVPU 요약 (keys: avpu, rr, bp_sys, bp_dia, hr, bt, spo2 등)",
    )

class NearestRoutingRequest(RoutingCandidateResponse):
    user_lat: float
    user_lon: float


class RoutePathRequest(BaseModel):
    start_lat: float
    start_lon: float
    end_lat: float
    end_lon: float


class RoutePathPoint(BaseModel):
    lat: float
    lon: float


class RoutePathResponse(BaseModel):
    path: List[RoutePathPoint] = Field(default_factory=list)
    distance: float = Field(..., description="총 거리(m)")
    duration_sec: int = Field(..., description="총 이동 시간(초)")
