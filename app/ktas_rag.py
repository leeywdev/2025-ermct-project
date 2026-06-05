from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

from openai import OpenAI

from app.openai_client import get_openai_client


@dataclass
class KtasGuidelineDoc:
    id: str
    title: str
    ktas_level: Optional[int]
    category: Optional[str]
    sub_category: Optional[str]
    text: str
    source: str
    age_group: Optional[str] = None
    first_impression: bool = False
    metadata: Dict[str, Any] = field(default_factory=dict)
    embedding: Optional[list[float]] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "title": self.title,
            "ktas_level": self.ktas_level,
            "category": self.category,
            "sub_category": self.sub_category,
            "text": self.text,
            "source": self.source,
            "age_group": self.age_group,
            "first_impression": self.first_impression,
            "metadata": self.metadata,
            "embedding": self.embedding,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "KtasGuidelineDoc":
        return cls(
            id=data["id"],
            title=data.get("title", ""),
            ktas_level=data.get("ktas_level"),
            category=data.get("category"),
            sub_category=data.get("sub_category"),
            text=data.get("text", ""),
            source=data.get("source", ""),
            age_group=data.get("age_group"),
            first_impression=data.get("first_impression", False),
            metadata=data.get("metadata", {}),
            embedding=data.get("embedding"),
        )


class KtasVectorStore:
    def __init__(self, docs: Optional[List[KtasGuidelineDoc]] = None) -> None:
        self.docs = docs or []
        self.embedding_model = "text-embedding-3-large"

    @classmethod
    def load(cls, path: Path) -> "KtasVectorStore":
        data = json.loads(path.read_text(encoding="utf-8"))
        docs = [KtasGuidelineDoc.from_dict(item) for item in data["documents"]]
        return cls(docs=docs)

    def save(self, path: Path) -> None:
        path.write_text(
            json.dumps(
                {
                    "documents": [doc.to_dict() for doc in self.docs],
                    "created_by": "ktas_rag",
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )

    def encode_text(self, text: str) -> list[float]:
        if not text.strip():
            return []
        client = get_openai_client()
        response = client.embeddings.create(model=self.embedding_model, input=text)
        return response.data[0].embedding

    @staticmethod
    def cosine_similarity(a: Iterable[float], b: Iterable[float]) -> float:
        a_list = list(a)
        b_list = list(b)
        if not a_list or not b_list or len(a_list) != len(b_list):
            return 0.0
        dot = sum(x * y for x, y in zip(a_list, b_list))
        norm_a = math.sqrt(sum(x * x for x in a_list))
        norm_b = math.sqrt(sum(y * y for y in b_list))
        if norm_a == 0 or norm_b == 0:
            return 0.0
        return dot / (norm_a * norm_b)

    def query(self, text: str, top_k: int = 5) -> List[Dict[str, Any]]:
        query_embedding = self.encode_text(text)
        if not query_embedding:
            return []

        hits: list[Dict[str, Any]] = []
        for doc in self.docs:
            if not doc.embedding:
                continue
            score = self.cosine_similarity(query_embedding, doc.embedding)
            hits.append({"doc": doc, "score": score})

        hits.sort(key=lambda item: item["score"], reverse=True)
        return [
            {
                "id": item["doc"].id,
                "title": item["doc"].title,
                "ktas_level": item["doc"].ktas_level,
                "category": item["doc"].category,
                "sub_category": item["doc"].sub_category,
                "text": item["doc"].text,
                "source": item["doc"].source,
                "first_impression": item["doc"].first_impression,
                "age_group": item["doc"].age_group,
                "metadata": item["doc"].metadata,
                "score": item["score"],
            }
            for item in hits[:top_k]
        ]


def build_rag_prompt(clean_text: str, sbar: dict, retrieved_docs: List[Dict[str, Any]]) -> str:
    guidance = [
        "당신은 한국 성인 응급환자의 KTAS 분류 전문가입니다.",
        "이 분류는 성인 환자만 대상으로 합니다. 소아/영유아 기준은 무시하세요.",
        "첫인상 평가는 5초 이내에 파악 가능한 중증 신호에 한정합니다.",
        "KTAS 1은 생명 위협성 또는 즉각적 소생/산소/순환 지원이 필요한 경우로 제한합니다.",
        "KTAS 2~5는 위급성 단계로, 문맥과 기준에 따라 3가지 후보를 추천하십시오.",
        "반드시 KTAS 1~5 숫자 형태로 반환합니다.",
        "출력은 JSON 배열만 사용하십시오.",
        "설명은 한국어로 작성하십시오."
    ]

    evidence_text = "\n\n".join(
        f"[{idx + 1}] id={doc['id']} ktas={doc.get('ktas_level')} title={doc['title']} score={doc['score']:.4f}\n{doc['text']}"
        for idx, doc in enumerate(retrieved_docs)
    )

    prompt = f"""
{chr(10).join(guidance)}

검색된 KTAS 가이드라인 문서:
{evidence_text}

환자 입력 원문:
{clean_text}

SBAR 구조화:
{sbar}

요청:
- 위 내용을 참고해 성인 환자의 KTAS 후보 3개를 추천하십시오.
- 각 후보는 ktas, reason, confidence(0.0~1.0) 필드를 가져야 합니다.
- confidence는 문맥과 검색된 가이드라인의 적합성을 반영하십시오.
- evidence 필드에는 참고한 문서 id를 1개 이상 포함하십시오.
- return only JSON array.
""".strip()
    return prompt


def parse_rag_response(text: str) -> List[Dict[str, Any]]:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.strip("`\n ")
    try:
        parsed = json.loads(cleaned)
        if isinstance(parsed, dict):
            return [parsed]
        if isinstance(parsed, list):
            return parsed
    except json.JSONDecodeError:
        raise ValueError("RAG 출력 JSON 파싱에 실패했습니다. 출력 텍스트를 확인하세요.")
    raise ValueError("RAG 출력이 리스트 또는 dict 형식이 아닙니다.")


def normalize_candidate(candidate: dict, top_similarity: float) -> dict:
    ktas = int(candidate.get("ktas") or 0)
    reason = str(candidate.get("reason") or "").strip()
    confidence = candidate.get("confidence")
    if confidence is None:
        confidence = 0.45 + 0.45 * top_similarity
    confidence = max(0.0, min(1.0, float(confidence)))
    evidence = candidate.get("evidence") or []
    if isinstance(evidence, str):
        evidence = [evidence]
    if not isinstance(evidence, list):
        evidence = [str(evidence)]
    return {
        "ktas": ktas,
        "reason": reason,
        "confidence": confidence,
        "evidence": evidence,
    }


def classify_ktas_rag(
    clean_text: str,
    sbar: dict,
    vector_store: KtasVectorStore,
    top_k: int = 5,
    candidate_count: int = 3,
) -> List[Dict[str, Any]]:
    retrieved = vector_store.query(clean_text + "\n" + json.dumps(sbar, ensure_ascii=False), top_k=top_k)
    if not retrieved:
        raise RuntimeError("RAG vector store에서 검색된 문서가 없습니다.")

    prompt = build_rag_prompt(clean_text, sbar, retrieved)
    response = get_openai_client().chat.completions.create(
        model="gpt-5.5",
        messages=[
            {"role": "system", "content": "KTAS RAG 추천 엔진입니다. 반드시 JSON 배열만 반환하세요."},
            {"role": "user", "content": prompt},
        ]
    )

    raw_output = response.choices[0].message.content
    candidates = parse_rag_response(raw_output)

    top_similarity = retrieved[0]["score"] if retrieved else 0.0
    normalized = [normalize_candidate(c, top_similarity) for c in candidates][:candidate_count]

    if len(normalized) < candidate_count:
        seen = {(item["ktas"], item["reason"]) for item in normalized}
        for doc in retrieved:
            if len(normalized) >= candidate_count:
                break
            if doc["ktas_level"] is None:
                continue
            fallback = {
                "ktas": int(doc["ktas_level"]),
                "reason": (
                    f"검색된 지침 문서 {doc['id']}에서 유사 KTAS {doc['ktas_level']}로 추정"
                ),
                "confidence": max(0.15, min(0.65, float(doc["score"]))),
                "evidence": [doc["id"]],
            }
            if (fallback["ktas"], fallback["reason"]) not in seen:
                normalized.append(fallback)
                seen.add((fallback["ktas"], fallback["reason"]))

    normalized.sort(key=lambda item: item["confidence"], reverse=True)
    return normalized[:candidate_count]
