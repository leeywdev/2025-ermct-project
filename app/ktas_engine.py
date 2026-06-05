import json
import os
from typing import Any, Dict, Tuple
from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
client = OpenAI(api_key=OPENAI_API_KEY) if OPENAI_API_KEY else None


def get_openai_client() -> OpenAI:
    if client is None:
        raise RuntimeError("OPENAI_API_KEY is not set. Add it to your .env file.")
    return client
# =====================================================
# 1. 기본 SBAR 템플릿
# =====================================================

DEFAULT_SBAR = {
    "S": {
        "age": None,
        "gender": None,
        "chief_complaint_group": None,
        "chief_complaint": None,
        "modifiers": [],
        "severity": None,
        "red_flags": [],
        "requirement": None
    },

    "B": {
        "htn": False,
        "dm": False,
        "hf": False,
        "cad": False,
        "mi_history": False,
        "stent": False,
        "anticoagulant": False,
        "pregnant": False,
        "immunocompromised": False,
        "recent_surgery": False,
        "dialysis": False,
        "followup_hospital": None
    },

    "A": {
        "mental_status": None,
        "gcs": None,
        "sbp": None,
        "dbp": None,
        "hr": None,
        "rr": None,
        "bt": None,
        "spo2": None,
        "nrs": None,
        "bst": None
    },

    "R": {
        "oxygen": {
            "used": False,
            "device": None,
            "flow": None
        },

        "iv_fluid": False,
        "drug": [],
        "cpr": False,
        "aed": False,
        "response": None
    }
}




# =====================================================
# 3. LLM2 호출부
# =====================================================

def call_llm2_for_sbar(clean_text: str) -> str:
    """
    여기를 네가 쓰는 LLM API 호출 코드로 바꾸면 됨.
    반환값은 반드시 JSON 문자열이어야 함.
    
    """

    prompt = f"""
    clean_text:
    {clean_text}
    """.strip()

    
    response = get_openai_client().chat.completions.create(
        model="gpt-5.5",
        messages=[
            {
                "role": "system",
                "content": f"""
    너는 119 구급대 발화문을 SBAR JSON으로 구조화하는 응급의료 정보 추출기다.

    반드시 JSON만 반환한다.
    설명 금지.
    markdown 금지.
    ```json 금지.

    반환 형식은 아래 스키마를 그대로 따라야 한다.

    {json.dumps(DEFAULT_SBAR, ensure_ascii=False, indent=2)}

    규칙:
    - 정보가 없으면 null 또는 false로 둔다.
    - 활력징후 수치는 숫자로 넣는다.
    - AVPU는 A, V, P, U 중 하나만 넣는다.
    - chief_complaint_group은 반드시 아래 중 하나만 사용합니다.
        Neurologic
        Respiratory
        Cardiovascular
        Gastrointestinal
        Trauma
        Infectious
        OBGYN
        Toxicology
        Genitourinary
        Eye_ENT
        Metabolic
        Bleeding
    - 심각도는 아래중 하나로 매핑합니다.
        mild | moderate | severe | unknown
    - chief_complaint_group은 대분류를 넣는다.
    - chief_complaint는 실제 주호소를 짧은 영어 의학 표현으로 정규화한다.
    예: 호흡곤란 → dyspnea, 흉통 → chest pain, 의식저하 → mental change
    - modifiers에는 KTAS 판단에 영향을 줄 수 있는 표현을 넣는다.
    예: severe dyspnea, moderate dyspnea, SpO2 85%, sudden onset, LOC positive, crushing pain, tearing pain
    - 활력징후는 숫자만 넣는다.
    - 의식 A 또는 alert는 mental_status: "alert"로 넣는다.
    - CPR/AED는 true/false로 넣는다.
    - severity와 red_flags는 문장의 전체 의미와 환자 상태를 바탕으로 의학적으로 판단합니다.
    - 표현이 정확히 일치하지 않아도 의미가 같으면 적절히 매핑합니다.
    - ktas 레벨도 예상해서 red_Flags 안에 숫자로 표기하세요.
    """
            },
            {
                "role": "user",
                "content": prompt
            }
        ],
        #temperature=0
    )

    return response.choices[0].message.content.strip()

    

# =====================================================
# 4. JSON 파싱
# =====================================================

def parse_sbar_json(llm_output: str) -> Dict[str, Any]:
    text = llm_output.strip()

    if text.startswith("```"):
        text = text.replace("```json", "").replace("```", "").strip()

    return json.loads(text)


# =====================================================
# 5. KTAS 1~3 분류기
# =====================================================

def classify_ktas(sbar: dict) -> dict:
    S = sbar.get("S") or {}
    B = sbar.get("B") or {}
    A = sbar.get("A") or {}
    R = sbar.get("R") or {}

    cc = str(S.get("chief_complaint") or "").lower()
    group = str(S.get("chief_complaint_group") or "").lower()

    modifiers_raw = S.get("modifiers") or []
    if isinstance(modifiers_raw, list):
        modifiers = " ".join(str(x) for x in modifiers_raw).lower()
    else:
        modifiers = str(modifiers_raw).lower()

    red_flags_raw = S.get("red_flags") or []
    if isinstance(red_flags_raw, list):
        red_flags = " ".join(str(x) for x in red_flags_raw).lower()
    else:
        red_flags = str(red_flags_raw).lower()

    severity = str(S.get("severity") or "").lower()
    requirement = str(S.get("requirement") or "").lower()

    text = f"{group} {cc} {modifiers} {red_flags} {severity} {requirement}"

    mental = str(A.get("mental_status") or "").lower()
    avpu = A.get("avpu")
    gcs = A.get("gcs")
    sbp = A.get("sbp")
    dbp = A.get("dbp")
    hr = A.get("hr")
    rr = A.get("rr")
    bt = A.get("bt")
    spo2 = A.get("spo2")
    nrs = A.get("nrs")
    bst = A.get("bst")

    oxygen = R.get("oxygen") or {}
    oxygen_device = str(oxygen.get("device") or "").lower()
    oxygen_flow = oxygen.get("flow") or 0

    drugs_raw = R.get("drug") or []
    if isinstance(drugs_raw, list):
        drugs = [str(d).lower() for d in drugs_raw]
    else:
        drugs = [str(drugs_raw).lower()]

    response = str(R.get("response") or "").lower()

    reasons = []

    def has(*keywords):
        return any(k.lower() in text for k in keywords)

    def is_trauma():
        return group == "trauma" or has(
            "trauma", "fall", "injury", "crush", "laceration",
            "amputation", "open wound", "head trauma", "facial trauma"
        )

    def is_chest_pain():
        return group == "cardiovascular" or has(
            "chest pain", "thorax pain", "crushing", "tearing"
        )

    def is_fever():
        return has("fever") or (bt is not None and bt >= 38.0)

    # ==================================================
    # KTAS 1
    # ==================================================

    if R.get("cpr") or R.get("aed"):
        return {"ktas": 1, "reason": "CPR/AED 시행"}

    if has("arrest", "cardiac arrest", "ongoing cpr"):
        return {"ktas": 1, "reason": "심정지 또는 CPR 상황"}

    if has("post resuscitation") and (
        mental == "coma" or (gcs is not None and gcs <= 8)
    ):
        return {"ktas": 1, "reason": "소생 후 중증 의식저하"}

    if mental == "coma":
        return {"ktas": 1, "reason": "coma 상태"}

    if gcs is not None and gcs <= 8:
        return {"ktas": 1, "reason": f"GCS {gcs}로 중증 의식저하"}

    if sbp is not None and sbp <= 80:
        return {"ktas": 1, "reason": f"SBP {sbp}로 쇼크 의심"}

    if has("shock", "severe hypotension"):
        return {"ktas": 1, "reason": "쇼크 또는 심한 저혈압 표현"}

    if has("massive bleeding", "gi massive bleed") and sbp is not None and sbp <= 90:
        return {"ktas": 1, "reason": "대량출혈 + 혈역학적 불안정"}

    if has("hematochezia", "hematemesis") and sbp is not None and sbp <= 90 and hr is not None and hr >= 120:
        return {"ktas": 1, "reason": "위장관 출혈 + 저혈압/빈맥"}

    if has("severe dyspnea", "respiratory failure", "impending respiratory failure"):
        if sbp is not None and sbp <= 90:
            return {"ktas": 1, "reason": "중증 호흡곤란 + 혈역학적 불안정"}
        return {"ktas": 1, "reason": "중증 호흡곤란 또는 호흡부전"}

    if spo2 is not None and spo2 < 85:
        return {"ktas": 1, "reason": f"SpO2 {spo2}%로 중증 저산소증"}

    if oxygen_device in ["bvm", "bag valve mask"]:
        return {"ktas": 1, "reason": "BVM 환기 필요"}

    if "epinephrine" in drugs and sbp is not None and sbp <= 90:
        return {"ktas": 1, "reason": "에피네프린 투여 + 저혈압"}

    # ==================================================
    # KTAS 2
    # ==================================================

    if mental in ["drowsy", "stupor"]:
        reasons.append(f"중등도 의식저하: {mental}")

    if gcs is not None and 9 <= gcs <= 13:
        reasons.append(f"GCS {gcs}로 중등도 의식저하")

    if has("mental change", "transient coma", "decreased mentality"):
        reasons.append("의식저하 병력 또는 mental change")

    if has("moderate dyspnea", "respiratory distress"):
        reasons.append("중등도 호흡곤란")

    if spo2 is not None and spo2 <= 90:
        reasons.append(f"SpO2 {spo2}% 저하")
    
    if spo2 is not None and avpu is not None and spo2 < 90 and avpu == "A":
        ktas = 2

    if rr is not None and rr >= 30:
        reasons.append(f"RR {rr}로 빈호흡")

    if oxygen.get("used") and oxygen_flow >= 10:
        reasons.append("고유량 산소 필요")

    if oxygen_device in ["nrb", "non-rebreather"]:
        reasons.append("NRB 산소 적용")

    if has("generalized edema") and has("dyspnea"):
        reasons.append("전신부종 동반 호흡곤란")

    if has(
        "hemiparesis", "dysarthria", "sudden visual loss",
        "sudden hearing loss", "amnesia", "stroke", "tia",
        "sudden onset", "1 hour", "2 hour", "within hours"
    ):
        reasons.append("급성 신경학적 증상 또는 뇌졸중 의심")

    if has(
        "crushing pain", "tearing pain", "troponin", "tni",
        "mi suspicion", "myocardial infarction", "acs",
        "pneumothorax", "chest tube", "transferred for intervention"
    ):
        reasons.append("ACS/대동맥박리/기흉 등 고위험 흉부질환 의심")

    if is_chest_pain() and (B.get("cad") or B.get("mi_history") or B.get("stent")):
        reasons.append("심혈관 병력 동반 흉통")

    if has(
        "loc positive", "fall from 3m", "3m fall", "fall from height",
        "distal circulation decreased", "uncontrolled bleeding",
        "machine injury", "crush injury", "penetrating injury",
        "open wound bleeding"
    ):
        reasons.append("위험 외상 또는 순환장애 동반 외상")

    if is_trauma() and B.get("anticoagulant"):
        reasons.append("항응고제 복용 중 외상")

    if B.get("pregnant") and has("headache", "abdominal pain", "vaginal bleeding", "labor pain"):
        reasons.append("임신 중 고위험 증상")

    if has("pregnancy", "pregnant", "vaginal bleeding", "labor pain"):
        reasons.append("산과 응급 가능성")

    fever = is_fever()
    tachycardia = hr is not None and hr >= 120
    tachypnea = rr is not None and rr >= 22

    if fever and (tachycardia or tachypnea):
        reasons.append("발열과 빈맥/빈호흡 동반")

    if fever and mental in ["drowsy", "stupor", "coma"]:
        reasons.append("발열과 의식저하 동반")

    if fever and B.get("immunocompromised"):
        reasons.append("면역저하 상태의 발열")

    if fever and B.get("recent_surgery"):
        reasons.append("최근 수술 후 발열")

    if fever and B.get("dialysis"):
        reasons.append("투석 환자의 발열")

    if has("intentional ingestion", "pesticide", "overdose", "poisoning", "hypnotics", "suicide"):
        reasons.append("중독 또는 자살 시도 가능성")

    if has("persistent bleeding", "moderate hematochezia", "large amount bleeding", "epistaxis persistent"):
        reasons.append("지속 출혈 또는 중등도 이상 출혈")

    if nrs is not None and nrs >= 9:
        reasons.append(f"NRS {nrs}의 심한 통증")

    if nrs is not None and nrs >= 8 and (
        (sbp is not None and sbp <= 100) or
        (hr is not None and hr >= 120)
    ):
        reasons.append(f"NRS {nrs}와 활력징후 이상 동반")

    if has("dyspnea") and B.get("hf"):
        reasons.append("심부전 병력 동반 호흡곤란")

    if bst is not None and bst >= 600:
        if has("headache", "weakness", "general weakness", "vomiting", "dehydration", "mental change", "dyspnea"):
            reasons.append("BST 600 이상 + 동반 증상")

    if "epinephrine" in drugs:
        reasons.append("에피네프린 투여 필요")

    if any(d in drugs for d in ["duoneb", "salbutamol", "albuterol", "bronchodilator"]):
        if has("dyspnea", "wheezing", "respiratory distress"):
            reasons.append("기관지확장제 처치 필요한 호흡곤란")

    if R.get("iv_fluid") and (sbp is not None and sbp <= 100):
        reasons.append("저혈압으로 수액 처치 필요")

    if response in ["no improvement", "worse", "aggravated"]:
        reasons.append("처치 후 호전 없음")

    if reasons:
        return {
            "ktas": 2,
            "reason": "; ".join(reasons)
        }

    return {
        "ktas": 3,
        "reason": "활력징후 안정, 고위험 modifier 없음"
    }


# =====================================================
# 6. 전체 KTAS 엔진
# =====================================================

def run_ktas_engine(
    clean_text: str,
    raw_hospital=None,
    final_hospital=None
) -> Dict[str, Any]:
    llm_output = call_llm2_for_sbar(clean_text)
    sbar = parse_sbar_json(llm_output)

    ktas_result = classify_ktas(sbar)
    llm_hospital = sbar.get("B", {}).get("followup_hospital")

    return {
        "text": clean_text,
        "sbar": sbar,
        "ktas": ktas_result["ktas"],
        "reason": ktas_result["reason"],
        "chief_complaint": sbar.get("S", {}).get("chief_complaint"),
        "requirement": sbar.get("S", {}).get("requirement"),
        "followup_hospital_raw": raw_hospital or llm_hospital,
        "followup_hospital": final_hospital or raw_hospital or llm_hospital,
    }


# =====================================================
# 7. 테스트용: LLM 없이 SBAR JSON 직접 넣는 경우
# =====================================================

def run_ktas_engine_from_sbar(sbar: Dict[str, Any]) -> Dict[str, Any]:

    ktas_result = classify_ktas(sbar)

    return {
        "sbar": sbar,
        "ktas_level": ktas_result["ktas"],
        "reason": ktas_result["reason"]
    }

if __name__ == "__main__":
    text = """
    """
    result = run_ktas_engine(
        clean_text=text,
        raw_hospital=None,
        final_hospital=None
    )

    print(result)
