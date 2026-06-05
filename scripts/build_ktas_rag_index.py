from __future__ import annotations

import argparse
import csv
from pathlib import Path
from typing import List

from app.ktas_rag import KtasGuidelineDoc, KtasVectorStore


CSV_HEADER = [
    "code",
    "category",
    "sub_category",
    "detail",
    "ktas",
    "note",
    "extra1",
    "extra2",
]


def parse_prektas_csv(csv_path: Path) -> List[KtasGuidelineDoc]:
    docs: List[KtasGuidelineDoc] = []
    with csv_path.open("r", encoding="utf-8", newline="") as f:
        reader = csv.reader(f)
        header = next(reader, None)
        for raw in reader:
            if not raw or all(not cell.strip() for cell in raw):
                continue
            row = raw + [""] * (len(CSV_HEADER) - len(raw))
            code = row[0].strip()
            category = row[1].strip() or None
            sub_category = row[2].strip() or None
            detail = row[3].strip() or None
            ktas = None
            if row[4].strip().isdigit():
                ktas = int(row[4].strip())
            notes = [cell.strip() for cell in row[5:] if cell.strip()]
            text_parts = [
                f"코드: {code}",
                f"분류: {category or 'unknown'}",
                f"세부분류: {sub_category or 'unknown'}",
                f"설명: {detail or ''}",
            ]
            if notes:
                text_parts.append("추가정보: " + " | ".join(notes))
            full_text = "\n".join(text_parts)
            docs.append(
                KtasGuidelineDoc(
                    id=f"prektas-{code}",
                    title=f"KTAS 분류 {code}",
                    ktas_level=ktas,
                    category=category,
                    sub_category=sub_category,
                    text=full_text,
                    source="original_pre-ktas.csv",
                    age_group="adult",
                    first_impression=False,
                    metadata={"notes": notes},
                )
            )
    return docs


def main() -> None:
    parser = argparse.ArgumentParser(description="Build KTAS guideline RAG index from CSV.")
    parser.add_argument("--csv", type=Path, help="원본 KTAS CSV 파일 경로", default=None)
    parser.add_argument("--output", type=Path, help="생성할 벡터 인덱스 JSON 경로", default=None)
    args = parser.parse_args()

    root = Path(__file__).resolve().parent.parent
    csv_path = args.csv or root / "data" / "original_pre-ktas.csv"
    index_path = args.output or root / "data" / "ktas_guideline_index.json"

    if not csv_path.exists():
        raise FileNotFoundError(
            f"KTAS CSV 파일을 찾을 수 없습니다: {csv_path}\n원본 CSV 파일을 data/ 폴더로 복사하거나 --csv 경로를 지정하세요."
        )

    docs = parse_prektas_csv(csv_path)
    store = KtasVectorStore(docs=docs)
    print(f"[INFO] 총 {len(docs)}개 문서 임베딩 생성 중... 이것은 호출 비용이 발생합니다.")
    for doc in store.docs:
        if doc.embedding is None:
            content = f"{doc.title}\n{doc.text}\nKTAS: {doc.ktas_level or 'unknown'}"
            doc.embedding = store.encode_text(content)

    store.save(index_path)
    print(f"[INFO] KTAS RAG 인덱스를 저장했습니다: {index_path}")


if __name__ == "__main__":
    main()
