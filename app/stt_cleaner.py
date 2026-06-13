#!/usr/bin/env python
# -*- coding: utf-8 -*-

import os
import re
import tempfile
from typing import Union, IO
from difflib import SequenceMatcher, get_close_matches

import whisper
from openai import OpenAI
from dotenv import load_dotenv
from app.ktas_engine import run_ktas_engine

load_dotenv()

os.environ["XDG_CACHE_HOME"] = r"C:\whisper_cache"
os.environ["WHISPER_CACHE_DIR"] = r"C:\whisper_cache"

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
if not OPENAI_API_KEY:
    print("⚠️ 경고: .env 파일에 OPENAI_API_KEY가 없습니다.")

client = OpenAI(api_key=OPENAI_API_KEY) if OPENAI_API_KEY else None
whisper_model = None

INVALID_STT_PATTERNS = [
    "시청해주셔서감사합니다",
    "구독좋아요",
    "좋아요부탁드립니다",
]


class InvalidSTTAudioError(ValueError):
    def __init__(self, message: str, reason: str, stt_text: str | None = None):
        super().__init__(message)
        self.reason = reason
        self.stt_text = stt_text


def normalize_stt_text(text: str) -> str:
    return "".join((text or "").strip().split())


def is_likely_stt_hallucination(text: str) -> bool:
    compact = normalize_stt_text(text)

    if not compact:
        return True

    if len(compact) <= 2:
        return True

    if compact in {"네", "예", "음", "어", "아"}:
        return True

    if "감사합니다" in compact and len(compact) <= 20:
        return True

    return any(pattern in compact for pattern in INVALID_STT_PATTERNS)


def is_repetition_amplified(raw_text: str, clean_text: str) -> bool:
    raw_compact = normalize_stt_text(raw_text)
    clean_compact = normalize_stt_text(clean_text)
    if not raw_compact or raw_compact == clean_compact:
        return False
    if clean_compact.count(raw_compact) >= 2:
        return True
    return False


def get_openai_client() -> OpenAI:
    if client is None:
        raise RuntimeError("OPENAI_API_KEY is not set. Add it to your .env file.")
    return client


def get_whisper_model():
    global whisper_model
    if whisper_model is None:
        print("[INFO] Whisper large-v3 모델 로딩 중...")
        whisper_model = whisper.load_model("large-v3")
        print("[INFO] Whisper large-v3 로딩 완료.")
    return whisper_model


def speech_to_text(audio_source: Union[str, IO]) -> str:
    model = get_whisper_model()

    if isinstance(audio_source, str):
        audio_path = audio_source
        delete_after = False
    else:
        delete_after = True
        source_name = str(getattr(audio_source, "name", "") or "")
        suffix = os.path.splitext(source_name)[1] or ".webm"
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            try:
                audio_source.seek(0)
            except Exception:
                pass
            tmp.write(audio_source.read())
            audio_path = tmp.name
        print("[stt] temporary audio path:", audio_path)
        print("[stt] temporary audio bytes:", os.path.getsize(audio_path))

    try:
        result = model.transcribe(audio_path, language="ko")
        return result["text"].strip()
    finally:
        if delete_after:
            try:
                os.remove(audio_path)
            except Exception:
                pass


SEOUL_HOSPITAL_DB = [
    "연세대학교의과대학강남세브란스병원",
    "삼성서울병원",
    "강동경희대학교의대병원",
    "성심의료재단강동성심병원",
    "한국보훈복지의료공단중앙보훈병원",
    "이화여자대학교의과대학부속서울병원",
    "부민병원",
    "의료법인서울효천의료재단에이치플러스양지병원",
    "건국대학교병원",
    "혜민병원",
    "고려대학교의과대학부속구로병원",
    "구로성심병원",
    "희명병원",
    "인제대학교상계백병원",
    "노원을지대학교병원",
    "한국원자력의학원원자력병원",
    "의료법인한전의료재단한일병원",
    "경희대학교병원",
    "삼육서울병원",
    "서울특별시동부병원",
    "서울성심병원",
    "서울특별시보라매병원",
    "중앙대학교병원",
    "연세대학교의과대학세브란스병원",
    "의료법인동신의료재단동신병원",
    "학교법인가톨릭학원가톨릭대학교서울성모병원",
    "한양대학교병원",
    "학교법인고려중앙학원고려대학교의과대학부속병원(안암병원)",
    "재단법인아산사회복지재단서울아산병원",
    "경찰병원",
    "이화여자대학교의과대학부속목동병원",
    "홍익병원",
    "서울특별시서남병원",
    "가톨릭대학교여의도성모병원",
    "한림대학교강남성심병원",
    "성애의료재단성애병원",
    "명지성모병원",
    "대림성모병원",
    "순천향대학교부속서울병원",
    "가톨릭대학교은평성모병원",
    "의료법인청구성심병원",
    "서울대학교병원",
    "강북삼성병원",
    "서울적십자병원",
    "세란병원",
    "국립중앙의료원",
    "서울특별시서울의료원",
    "의료법인풍산의료재단동부제일병원",
    "녹색병원"
]


STATIC_MAP = {
    "세브란스": "연세대학교의과대학세브란스병원",
    "세브": "연세대학교의과대학세브란스병원",
    "본세브": "연세대학교의과대학세브란스병원",
    "신촌세브": "연세대학교의과대학세브란스병원",

    "강남세브란스": "연세대학교의과대학강남세브란스병원",
    "강남세브": "연세대학교의과대학강남세브란스병원",
    "강세브": "연세대학교의과대학강남세브란스병원",

    "서울성모": "학교법인가톨릭학원가톨릭대학교서울성모병원",
    "반포성모": "학교법인가톨릭학원가톨릭대학교서울성모병원",

    "여의도성모": "가톨릭대학교여의도성모병원",
    "여성모": "가톨릭대학교여의도성모병원",

    "은평성모": "가톨릭대학교은평성모병원",

    "안암": "학교법인고려중앙학원고려대학교의과대학부속병원(안암병원)",
    "고대안암": "학교법인고려중앙학원고려대학교의과대학부속병원(안암병원)",

    "구로고대": "고려대학교의과대학부속구로병원",
    "고대구로": "고려대학교의과대학부속구로병원",
    "고대 구로": "고려대학교의과대학부속구로병원",

    "이대서울": "이화여자대학교의과대학부속서울병원",
    "이대 서울": "이화여자대학교의과대학부속서울병원",
    "이화서울": "이화여자대학교의과대학부속서울병원",

    "이대목동": "이화여자대학교의과대학부속목동병원",
    "목동이대": "이화여자대학교의과대학부속목동병원",
    "목동 병원": "이화여자대학교의과대학부속목동병원",

    "삼성서울": "삼성서울병원",
    "삼성 병원": "삼성서울병원",
    "smc": "삼성서울병원",

    "강북삼성": "강북삼성병원",
    "강북 삼성": "강북삼성병원",

    "강동성심": "성심의료재단강동성심병원",
    "구로성심": "구로성심병원",
    "청구성심": "의료법인청구성심병원",
}


def llm_clean_text(raw_text: str) -> str:
    prompt = f"""


[입력 STT 원문]
{raw_text}


{raw_text}
"""

    try:
        response = get_openai_client().chat.completions.create(
            model="gpt-5.5",
            messages=[
                {
                    "role": "system",
                    "content": """
        당신은 119 구급대원의 응급실 전화보고 문장을 자연스럽고 정확하게 보정하는 LLM입니다.

        [목표]
        - STT 원문의 의미를 유지하며 한국어 문장만 자연스럽게 정리합니다.
        - 숫자(나이·혈압·맥박·호흡수·SpO₂·체온 등)는 변경하지 않습니다.
        - 병원명은 반드시 제공된 병원리스트 중 하나로 보정합니다.
        - 존재하지 않는 병원명을 생성하지 않습니다.
        - “평소 다니던/외래/팔로업” 언급 시 병원 보정 규칙을 적용합니다.

        [병원명 보정 규칙]
        STT원문에 기재된 병원명이 정식 병원명 리스트에 있다면 STT원문에 기재된 병원명 그대로 놔둡니다.
        다음 단축/비표준 명칭은 → 오른쪽의 정식 병원명으로 변경합니다.
        세브란스/세브/본세브/신촌세브 → 연세대학교의과대학세브란스병원
        강남세브란스/강남세브/강세브 → 연세대학교의과대학강남세브란스병원
        서울성모/반포성모 → 학교법인가톨릭학원가톨릭대학교서울성모병원
        여의도성모/여성모/여의성모 → 가톨릭대학교여의도성모병원
        은평성모 → 가톨릭대학교은평성모병원
        안암/고대안암 → 학교법인고려중앙학원고려대학교의과대학부속병원(안암병원)
        구로고대/고대구로 → 고려대학교의과대학부속구로병원
        이대서울/이화서울 → 이화여자대학교의과대학부속서울병원
        이대목동/목동이대/목동 병원 → 이화여자대학교의과대학부속목동병원
        삼성서울/삼성 병원/smc → 삼성서울병원
        강북삼성 → 강북삼성병원
        강동성심 → 성심의료재단강동성심병원
        36병원/36/삼육 → 삼육서울병원
        구로성심 → 구로성심병원
        청구성심 → 의료법인청구성심병원
        강남성심 → 한림대학교강남성심병원
        서울대/서울대병원 → 서울대학교병원
        아산병원/서울아산 → 재단법인아산사회복지재단서울아산병원
        보라매 → 서울특별시보라매병원
        서남병원/서남 → 서울특별시서남병원

        [정식 병원명 리스트]
        (이 리스트는 원문 그대로 유지)  
        연세대학교의과대학강남세브란스병원  
        삼성서울병원  
        강동경희대학교의대병원  
        성심의료재단강동성심병원  
        한국보훈복지의료공단중앙보훈병원  
        이화여자대학교의과대학부속서울병원  
        부민병원  
        의료법인서울효천의료재단에이치플러스양지병원  
        건국대학교병원  
        혜민병원  
        고려대학교의과대학부속구로병원  
        구로성심병원  
        희명병원  
        인제대학교상계백병원  
        노원을지대학교병원  
        한국원자력의학원원자력병원  
        의료법인한전의료재단한일병원  
        경희대학교병원  
        삼육서울병원  
        서울특별시동부병원  
        서울성심병원  
        서울특별시보라매병원  
        중앙대학교병원  
        연세대학교의과대학세브란스병원  
        의료법인동신의료재단동신병원  
        학교법인가톨릭학원가톨릭대학교서울성모병원  
        한양대학교병원  
        학교법인고려중앙학원고려대학교의과대학부속병원(안암병원)  
        재단법인아산사회복지재단서울아산병원  
        경찰병원  
        이화여자대학교의과대학부속목동병원  
        홍익병원  
        서울특별시서남병원  
        가톨릭대학교여의도성모병원  
        한림대학교강남성심병원  
        성애의료재단성애병원  
        명지성모병원  
        대림성모병원  
        순천향대학교부속서울병원  
        가톨릭대학교은평성모병원  
        의료법인청구성심병원  
        서울대학교병원  
        강북삼성병원  
        서울적십자병원  
        세란병원  
        국립중앙의료원  
        서울특별시서울의료원  
        의료법인풍산의료재단동부제일병원  
        녹색병원  

        [음성 인식 오류 보정]
        - STT 결과에서 응급의료 문맥상 어색한 단어는 발음과 문맥을 함께 고려해 자연스럽게 보정한다.
        - 단, 원문에 없는 새로운 의학 정보는 추가하지 않는다.
        - 산소 투여 장비, 수액, 부정맥, 의식수준, 주호소 표현은 응급보고 문맥에 맞게 표준 표현으로 정리한다.
        - 예: NRB, Nasal prong, V-tach, V-fib, NS, AVPU 등은 문맥상 맞는 표준 의학 약어로 보정한다.

        [AVPU 보정]
        - 의식수준 표현은 A, V, P, U 중 하나로 정규화한다.
        - 한국어 발음으로 말한 경우에도 가장 가까운 AVPU 단계로 해석한다.
        - 최종 문장은 “의식은 A/V/P/U입니다” 형식으로 정리한다.

        [출력]
        - 교정된 응급전화 보고 문장만 출력한다.
        - 설명, 근거, 목록은 출력하지 않는다.
        """
                },

                {
                    "role": "user",
                    "content": prompt
                }
            ],

            #temperature=0.1,
        )
        
        return response.choices[0].message.content.strip()

    except Exception as e:
        print("\n[LLM ERROR]", str(e))
        return raw_text


def token_similarity(a: str, b: str) -> float:
    return SequenceMatcher(None, a, b).ratio()


def best_match_hospital(raw_text, hospital_db):
    if not raw_text:
        return None

    text = raw_text.strip()
    norm = text.replace(" ", "")

    if ("세브란스" in norm) or ("세브" in norm):
        if "강남" in norm:
            return "연세대학교의과대학강남세브란스병원"
        return "연세대학교의과대학세브란스병원"

    if "성모" in norm:
        if "여의도" in norm or "여성모" in norm:
            return "가톨릭대학교여의도성모병원"
        if "은평" in norm:
            return "가톨릭대학교은평성모병원"
        if "명지" not in norm and "대림" not in norm:
            return "학교법인가톨릭학원가톨릭대학교서울성모병원"

    if "고대" in norm or "안암" in norm or ("구로" in norm and "고대" in norm):
        if "구로" in norm:
            return "고려대학교의과대학부속구로병원"
        return "학교법인고려중앙학원고려대학교의과대학부속병원(안암병원)"

    if ("이대" in norm) or ("이화" in norm):
        if "목동" in norm:
            return "이화여자대학교의과대학부속목동병원"
        return "이화여자대학교의과대학부속서울병원"

    if "삼성" in norm:
        if "강북" in norm:
            return "강북삼성병원"
        return "삼성서울병원"

    if "서울대" in norm:
        if "보라매" not in norm:
            return "서울대학교병원"

    if "아산" in norm:
        return "재단법인아산사회복지재단서울아산병원"

    if "순천향" in norm:
        return "순천향대학교부속서울병원"

    if "백병원" in norm:
        return "인제대학교상계백병원"

    for key in sorted(STATIC_MAP.keys(), key=len, reverse=True):
        if key in norm:
            return STATIC_MAP[key]

    m = re.search(r'([가-힣A-Za-z0-9\s]*병원)', text)
    if m:
        core = m.group(1).strip()
    else:
        core = text

    cleaned = core.replace(" ", "").replace("병원", "")
    tokens = re.findall(r"[가-힣]+", cleaned)

    if not tokens:
        fallback = get_close_matches(core, hospital_db, n=1, cutoff=0.4)
        return fallback[0] if fallback else None

    best_hospital = None
    best_score = 0.0

    for hosp in hospital_db:
        hosp_clean = hosp.replace(" ", "")
        hosp_tokens = re.findall(r"[가-힣]+", hosp_clean)

        score = 0.0
        for t in tokens:
            for ht in hosp_tokens:
                sim = token_similarity(t, ht)
                if sim > score:
                    score = sim

        if score > best_score:
            best_score = score
            best_hospital = hosp

    if best_score >= 0.70:
        return best_hospital

    fallback = get_close_matches(core, hospital_db, n=1, cutoff=0.5)
    return fallback[0] if fallback else None


def extract_followup_hospital(text: str):
    hospital_none_patterns = [
        r"병원.{0,20}(안\s*다니|안\s*다녀|안\s*다녔|다닌\s*곳\s*없|다니는\s*곳\s*없|따로\s*없|없[어요습니다]*)",
        r"(안\s*다니|안\s*다녀|안\s*다녔|다닌\s*곳\s*없|다니는\s*곳\s*없|따로\s*없|없[어요습니다]*)\s*병원",
        r"평소\s*다니는\s*병원\s*없",
        r"다니던\s*병원\s*없",
        r"병원\s*모르겠",
        r"병원\s*모름",
        r"병원\s*없",
    ]

    for pattern in hospital_none_patterns:
        if re.search(pattern, text, re.IGNORECASE):
            return None

    hospital_patterns = [
        r"(?:기존|평소|다니던|주로|단골)\s*.*?([가-힣A-Za-z0-9\s]+병원)",
        r"([가-힣A-Za-z0-9\s]+병원)\s*다니",
        r"(?:병원)\s*([가-힣A-Za-z0-9\s]+병원)\s*다녔",
    ]

    for hp in hospital_patterns:
        m = re.search(hp, text)
        if m:
            return m.group(1).strip()

    followup_patterns = [
        r'([가-힣A-Za-z0-9\s]+병원).*?(팔로업|팔로우업|follow[-\s]?up|추적|추적관찰|외래|경과관찰)',
        r'(팔로업|팔로우업|follow[-\s]?up|추적|추적관찰|외래).*?([가-힣A-Za-z0-9\s]+병원)',
        r'([가-힣A-Za-z0-9\s]+병원).*(보던|다니던|다녔던|관리받는|진료받는)',
    ]

    for fp in followup_patterns:
        m = re.search(fp, text)
        if m:
            if m.lastindex and m.group(1) and "병원" in m.group(1):
                return m.group(1).strip()
            elif m.lastindex and m.group(2):
                return m.group(2).strip()
            
    for key in sorted(STATIC_MAP.keys(), key=len, reverse=True):
        if key in text.replace(" ", ""):
            return key

    return None


def transcribe_clean_and_match_hospital(audio_source: Union[str, IO]) -> dict:
    print("[INFO] 음성 인식 중...")
    raw_text = speech_to_text(audio_source)

    print("\n[STT 결과]")
    print(raw_text)

    if is_likely_stt_hallucination(raw_text):
        raise InvalidSTTAudioError(
            "음성이 명확하게 인식되지 않았습니다. 증상을 다시 녹음해주세요.",
            reason="stt_hallucination",
            stt_text=raw_text,
        )

    clean_text = llm_clean_text(raw_text)
    

    print("\n[LLM 보정 후 문장]")
    print(clean_text)

    if is_likely_stt_hallucination(clean_text) or is_repetition_amplified(raw_text, clean_text):
        raise InvalidSTTAudioError(
            "음성이 명확하게 인식되지 않았습니다. 증상을 다시 녹음해주세요.",
            reason="stt_cleaning_invalid",
            stt_text=raw_text,
        )

    raw_hospital = extract_followup_hospital(clean_text)
    final_hospital = best_match_hospital(raw_hospital, SEOUL_HOSPITAL_DB)

    print("\n[병원 매칭 결과]")
    print(f"추출 병원명: {raw_hospital or '정보 없음'}")
    print(f"정규화 병원명: {final_hospital or '정보 없음'}")

    result = run_ktas_engine(
        clean_text,
        raw_hospital,
        final_hospital
    )

    return result
    
    return {
         "raw_text": raw_text,
         "clean_text": clean_text,
         "raw_hospital": raw_hospital,
         "final_hospital": final_hospital
     }


def ktas_from_audio(audio_source: Union[str, IO]) -> dict:
    return transcribe_clean_and_match_hospital(audio_source)


def ktas_from_text(text: str) -> dict:
    clean_text = llm_clean_text(text)
    raw_hospital = extract_followup_hospital(clean_text)
    final_hospital = best_match_hospital(raw_hospital, SEOUL_HOSPITAL_DB)
    return run_ktas_engine(clean_text, raw_hospital, final_hospital)


def build_stage2_payload(stage1_result: dict) -> dict:
    return {
        "ktas_level": int(stage1_result.get("ktas", 0) or 0),
        "chief_complaint": stage1_result.get("chief_complaint") or "unknown",
        "hospital_followup": (
            stage1_result.get("followup_hospital")
            or stage1_result.get("followup_hospital_raw")
        ),
    }


if __name__ == "__main__":
    

    audio_path = "test.m4a"
    result = transcribe_clean_and_match_hospital(audio_path)

    print("\n===== 최종 결과 =====")
    print(result)
