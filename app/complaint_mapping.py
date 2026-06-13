# app/complaint_mapping.py
from __future__ import annotations

from typing import Dict, List, Set, Optional

from app.schemas import HospitalSummary


# -----------------------------
# 10개 주증상 카테고리 정의
# -----------------------------

COMPLAINT_LABELS: Dict[int, str] = {
    1: "가슴 통증 (Chest pain)",
    2: "호흡곤란 (Dyspnea / Respiratory distress)",
    3: "신경학적 증상 (Stroke-like symptoms: 편마비, 말어눌함, 경련)",
    4: "복통 / 소화기 증상 (Abdominal pain / GI bleeding / vomiting)",
    5: "출혈 (External bleeding / hematemesis / melena)",
    6: "의식 변화 (Altered mental status / syncope)",
    7: "외상 (Trauma: 교통사고, 낙상, 절단, 화상 포함)",
    8: "산부인과 응급 (OB-GYN emergency: 분만, 산과/부인과 통증)",
    9: "소아 응급 (Pediatric acute illness: 열, 경련, 탈수 등)",
    10: "정신과적 응급 (Psychiatric emergency: 자살위험, 폭력성, 급성정신병)",
}


# -------------------------------------------------
# MKioskTyXX -> 주증상 카테고리 ID 집합 매핑
# -------------------------------------------------
# - MKioskTy 1~6  → 1(가슴통증), 2(호흡곤란), 3(신경학), 6(의식변화)
# - MKioskTy 7~14 → 기본은 4(복통/소화기) / 타입에 따라 5(출혈), 9(소아), 2(호흡곤란) 추가
# - MKioskTy 15~17 → 8(산부인과) / 9(소아)
# - MKioskTy 19 → 7(외상: 화상)
# - MKioskTy 20~21 → 7(외상: 사지접합)
# - MKioskTy 22~23 → 6(의식변화·전신 악화에서 응급투석 감별)
# - MKioskTy 24 → 10(정신과적 응급)
# - MKioskTy 25 → 5(출혈) + 7(외상)
# - MKioskTy 26~27 → 1,2,3,4 (대부분의 중증 내과/뇌혈관/복부 케이스)
# - MKioskTy 28 → 경비원 여부라 triage 로직에서는 제외

MKIOSK_TO_COMPLAINTS: Dict[str, Set[int]] = {
    # 1~6: 심근경색, 뇌경색, 뇌출혈, 대동맥질환
    "MKioskTy1": {1, 2, 3, 6},
    "MKioskTy2": {1, 2, 3, 6},
    "MKioskTy3": {1, 2, 3, 6},
    "MKioskTy4": {1, 2, 3, 6},
    "MKioskTy5": {1, 2, 3, 6},
    "MKioskTy6": {1, 2, 3, 6},

    # 7~9: 비외상 복부 응급수술 (복통/소화기)
    "MKioskTy7": {4},
    "MKioskTy8": {4},
    "MKioskTy9": {4},

    # 10: 장중첩/폐색 (영유아 복통 + 소아 응급)
    "MKioskTy10": {9},

    # 11~12: 위장관 내시경 (복통/소화기 + GI bleeding → 출혈도 함께)
    "MKioskTy11": {4, 5},
    "MKioskTy12": {4, 5, 9},  # 영유아 GI → 소아 응급 포함

    # 13~14: 기관지 내시경 (호흡곤란, 흡인, 소아 호흡곤란)
    "MKioskTy13": {2, 4},
    "MKioskTy14": {2, 4, 9},

    # 15: 저체중 출생아 집중치료 (신생아 + 산부인과)
    "MKioskTy15": {8, 9},

    # 16~18: 분만/산과/부인과 수술
    "MKioskTy16": {8},
    "MKioskTy17": {8},
    "MKioskTy18": {8},

    # 19: 화상 = 외상
    "MKioskTy19": {7},

    # 20~21: 사지접합 = 외상
    "MKioskTy20": {7},
    "MKioskTy21": {7},

    # 22~23: 응급투석 = 의식변화/전신상태 악화
    "MKioskTy22": {6},
    "MKioskTy23": {6},

    # 24: 정신과적 응급
    "MKioskTy24": {10},

    # 25: 안과수술 (외상성/출혈성 상황 모두 가능)
    "MKioskTy25": {5, 7},

    # 26~27: 영상의학 혈관중재 (ACS/Stroke/복부급성 등)
    "MKioskTy26": {1, 2, 3, 4},
    "MKioskTy27": {1, 2, 3, 4},

    # 28: 응급실 경비원 여부
    # "MKioskTy28": set(),
}


# -------------------------------------------------
# 주증상 ID -> ProcedureGroup ID 리스트 매핑
#   (triage 단계에서 어떤 수술 capability를 요구할지 정의)
# -------------------------------------------------

# 10개 주증상 → 필요한 procedure group 리스트
COMPLAINT_TO_PROCEDURE_GROUPS: Dict[int, List[str]] = {
    # 1. 가슴 통증 (Chest pain)
    #    - 심근경색, 대동맥박리/파열, 필요시 혈관중재
    1: ["ACS_MI", "AORTIC_EMERGENCY", "IR_INTERVENTION"],

    # 2. 호흡곤란 (Dyspnea / Respiratory distress)
    #    - 심근경색/뇌경색/대동맥응급 + 기관지내시경 + GI 출혈 내시경
    2: ["ACS_MI", "ACS_STROKE", "AORTIC_EMERGENCY", "BRONCHOSCOPY", "GI_ENDOSCOPY"],

    # 3. 신경학적 증상 (Stroke-like)
    #    - 허혈성 뇌졸중 재관류/중재 + 뇌출혈 수술
    3: ["ACS_STROKE", "BRAIN_HEMORRHAGE"],

    # 4. 복통 / 소화기 증상
    #    - 복부응급수술 + GI 내시경 + 장중첩/장폐색
    4: ["ABDOMINAL_EMERGENCY", "GI_ENDOSCOPY", "INTUSSUSCEPTION"],

    # 5. 출혈 (외부출혈 / 토혈 / 흑색변 등)
    #    - GI 내시경 + 혈관중재(IR) + 안과 출혈/손상
    5: ["GI_ENDOSCOPY", "IR_INTERVENTION", "EYE_EMERGENCY"],

    # 6. 의식 변화 (AMS / syncope / 경련 등)
    #    - 심근경색/뇌졸중/대동맥응급 + 응급투석
    6: ["ACS_MI", "ACS_STROKE", "AORTIC_EMERGENCY", "EMERGENCY_DIALYSIS"],

    # 7. 외상 (교통사고, 낙상, 절단, 화상 포함)
    #    - 사지접합, 중증화상, 혈관중재(IR)
    7: ["LIMB_REPLANTATION", "SEVERE_BURN", "IR_INTERVENTION"],

    # 8. 산부인과 응급 (분만, 산과/부인과 통증)
    #    - 분만/산과수술
    8: ["OB_EMERGENCY"],

    # 9. 소아 응급 (열, 경련, 탈수 등 + 중증 소아)
    #    - 장중첩/폐색, 소아 GI/기관지 내시경, 저체중 출생아 NICU
    9: ["INTUSSUSCEPTION", "GI_ENDOSCOPY", "BRONCHOSCOPY", "NEONATE_LBW"],

    # 10. 정신과적 응급 (자살위험, 폭력성, 급성정신병)
    #     - 폐쇄병동 입원 가능 병원
    10: ["PSYCHIATRIC_EMERGENCY"],
}

# KTAS 쪽에서 들어오는 chief_complaint 코드 → complaint_id 매핑
CHIEF_COMPLAINT_CODE_TO_ID: dict[str, int] = {
    # 1. 가슴 통증
    "chest_pain": 1,

    # 2. 호흡곤란
    "dyspnea": 2,
    "respiratory_distress": 2,

    # 3. 신경학적 증상
    "neuro": 3,
    "neuro_deficit": 3,
    "stroke_like": 3,

    # 4. 복통 / 소화기
    "abdominal": 4,
    "abdominal_pain": 4,
    "gi_symptom": 4,

    # 5. 출혈
    "bleeding": 5,

    # 6. 의식 변화
    "ams": 6,
    "altered": 6,
    "altered_mental_status": 6,

    # 7. 외상
    "trauma": 7,

    # 8. 산부인과 응급
    "obgyn": 8,
    "ob_gyn": 8,
    "pregnancy": 8,

    # 9. 소아 응급
    "pediatric": 9,
    "ped": 9,

    # 10. 정신과적
    "psy": 10,
    "psychiatric": 10,
}

CHIEF_COMPLAINT_CANONICAL_BY_ID: dict[int, str] = {
    1: "chest_pain",
    2: "dyspnea",
    3: "neuro",
    4: "abdominal",
    5: "bleeding",
    6: "altered",
    7: "trauma",
    8: "obgyn",
    9: "pediatric",
    10: "psychiatric",
}

CHIEF_COMPLAINT_ALIAS_TO_CANONICAL: dict[str, str] = {
    "chest_pain": "chest_pain",
    "chest pain": "chest_pain",
    "chest": "chest_pain",
    "흉통": "chest_pain",
    "가슴 통증": "chest_pain",
    "dyspnea": "dyspnea",
    "respiratory_distress": "dyspnea",
    "respiratory distress": "dyspnea",
    "shortness of breath": "dyspnea",
    "sob": "dyspnea",
    "숨을 못 쉼": "dyspnea",
    "숨을 못쉼": "dyspnea",
    "숨 못 쉼": "dyspnea",
    "숨못쉼": "dyspnea",
    "호흡곤란": "dyspnea",
    "neuro": "neuro",
    "neuro_deficit": "neuro",
    "neuro deficit": "neuro",
    "neurologic deficit": "neuro",
    "stroke_like": "neuro",
    "stroke like": "neuro",
    "stroke-like": "neuro",
    "acute focal weakness": "neuro",
    "focal weakness": "neuro",
    "unilateral weakness": "neuro",
    "weakness on one side": "neuro",
    "paralysis": "neuro",
    "hemiparesis": "neuro",
    "편측 약화": "neuro",
    "한쪽 마비": "neuro",
    "마비": "neuro",
    "신경학적 결손": "neuro",
    "뇌졸중 의심": "neuro",
    "abdominal": "abdominal",
    "abdominal_pain": "abdominal",
    "abdominal pain": "abdominal",
    "gi_symptom": "abdominal",
    "gi symptom": "abdominal",
    "bleeding": "bleeding",
    "ams": "altered",
    "altered": "altered",
    "altered_mental_status": "altered",
    "altered mental status": "altered",
    "trauma": "trauma",
    "low back pain": "trauma",
    "lower back pain": "trauma",
    "back pain": "trauma",
    "lumbar pain": "trauma",
    "lumbago": "trauma",
    "back injury": "trauma",
    "허리 통증": "trauma",
    "허리가 아픔": "trauma",
    "허리 아파요": "trauma",
    "요통": "trauma",
    "등 통증": "trauma",
    "허리 부상": "trauma",
    "obgyn": "obgyn",
    "ob_gyn": "obgyn",
    "ob gyn": "obgyn",
    "pregnancy": "obgyn",
    "pediatric": "pediatric",
    "ped": "pediatric",
    "psy": "psychiatric",
    "psychiatric": "psychiatric",
    "flank pain": "abdominal",
    "renal colic": "abdominal",
    "kidney stone": "abdominal",
    "옆구리 통증": "abdominal",
}

CHIEF_COMPLAINT_PHRASE_TO_CANONICAL: tuple[tuple[str, str], ...] = (
    ("acute focal weakness", "neuro"),
    ("focal weakness", "neuro"),
    ("unilateral weakness", "neuro"),
    ("weakness on one side", "neuro"),
    ("neuro deficit", "neuro"),
    ("neurologic deficit", "neuro"),
    ("stroke like", "neuro"),
    ("stroke-like", "neuro"),
    ("stroke", "neuro"),
    ("paralysis", "neuro"),
    ("hemiparesis", "neuro"),
    ("편측 약화", "neuro"),
    ("한쪽 마비", "neuro"),
    ("마비", "neuro"),
    ("신경학적 결손", "neuro"),
    ("뇌졸중 의심", "neuro"),
    ("뇌졸중", "neuro"),
    ("dyspnea", "dyspnea"),
    ("respiratory distress", "dyspnea"),
    ("shortness of breath", "dyspnea"),
    ("low back pain", "trauma"),
    ("lower back pain", "trauma"),
    ("back pain", "trauma"),
    ("lumbar pain", "trauma"),
    ("lumbago", "trauma"),
    ("back injury", "trauma"),
    ("허리 통증", "trauma"),
    ("허리가 아픔", "trauma"),
    ("허리 아파요", "trauma"),
    ("요통", "trauma"),
    ("등 통증", "trauma"),
    ("허리 부상", "trauma"),
    ("flank pain", "abdominal"),
    ("renal colic", "abdominal"),
    ("kidney stone", "abdominal"),
    ("옆구리 통증", "abdominal"),
    ("숨을 못", "dyspnea"),
    ("숨 못", "dyspnea"),
    ("숨못", "dyspnea"),
    ("호흡곤란", "dyspnea"),
)

# -------------------------------------------------
# Helper 함수들
# -------------------------------------------------

def normalize_chief_complaint(code: str | None) -> str | None:
    """
    Normalize KTAS/STT/route chief_complaint values to route canonical codes.
    """
    if not code:
        return None

    key = str(code).strip().lower()
    if not key:
        return None

    if key in CHIEF_COMPLAINT_ALIAS_TO_CANONICAL:
        return CHIEF_COMPLAINT_ALIAS_TO_CANONICAL[key]

    underscored_key = key.replace("-", "_").replace(" ", "_")
    if underscored_key in CHIEF_COMPLAINT_ALIAS_TO_CANONICAL:
        return CHIEF_COMPLAINT_ALIAS_TO_CANONICAL[underscored_key]

    spaced_key = key.replace("_", " ").replace("-", " ")
    if spaced_key in CHIEF_COMPLAINT_ALIAS_TO_CANONICAL:
        return CHIEF_COMPLAINT_ALIAS_TO_CANONICAL[spaced_key]

    for phrase, canonical in CHIEF_COMPLAINT_PHRASE_TO_CANONICAL:
        if phrase in key or phrase in spaced_key:
            return canonical

    if key in CHIEF_COMPLAINT_CODE_TO_ID:
        complaint_id = CHIEF_COMPLAINT_CODE_TO_ID[key]
        return CHIEF_COMPLAINT_CANONICAL_BY_ID.get(complaint_id)

    return None


def complaint_id_from_chief_complaint(code: str | None) -> int | None:
    """
    KTAS 모듈에서 넘어오는 chief_complaint 코드를
    내부 complaint_id(1~10)로 변환.
    """
    canonical = normalize_chief_complaint(code)
    if not canonical:
        return None
    return CHIEF_COMPLAINT_CODE_TO_ID.get(canonical)


def required_procedure_groups_for_complaint(complaint_id: int) -> List[str]:
    """
    주증상 ID(1~10)를 받아서,
    triage에서 요구해야 할 ProcedureGroup ID 리스트를 반환.
    정의되지 않은 complaint_id면 빈 리스트 반환.
    """
    return COMPLAINT_TO_PROCEDURE_GROUPS.get(int(complaint_id), [])


def complaints_from_mkiosk_flags(mkiosk: Dict[str, Optional[str]]) -> Set[int]:
    """
    MKioskTy 플래그 dict(MKioskTy1~MKioskTy27)를 보고,
    이 병원이 커버 가능한 주증상 카테고리 ID 집합을 추론한다.
    """
    supported: Set[int] = set()

    for key, raw in mkiosk.items():
        if not raw:
            continue
        v = str(raw).strip()
        if not v:
            continue

        # 문서 기준: Y로 시작하면 가능, 그 외(N, N1, 공백 등)는 불가/미제공 취급
        if not v.upper().startswith("Y"):
            continue

        if key in MKIOSK_TO_COMPLAINTS:
            supported.update(MKIOSK_TO_COMPLAINTS[key])

    return supported


def complaints_supported_by_hospital(summary: HospitalSummary) -> Set[int]:
    """
    HospitalSummary 하나를 받아서,
    serious.mkiosk + basic.raw_fields 두 소스를 모두 활용해
    이 병원이 커버 가능한 주증상 카테고리 ID 집합을 계산한다.
    """
    supported: Set[int] = set()

    # 1) 중증질환 수용 API (SeriousDiseaseStatus.mkiosk)
    if summary.serious and summary.serious.mkiosk:
        supported.update(complaints_from_mkiosk_flags(summary.serious.mkiosk))

    # 2) 기본정보에 있는 MKioskTyXX로 보강
    if summary.basic and summary.basic.raw_fields:
        basic_mkiosk = {
            key: value
            for key, value in summary.basic.raw_fields.items()
            if key.startswith("MKioskTy")
        }
        supported.update(complaints_from_mkiosk_flags(basic_mkiosk))

    return supported
