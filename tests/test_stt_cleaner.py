from __future__ import annotations

import unittest

from app.stt_cleaner import is_likely_stt_hallucination


class STTCleanerTests(unittest.TestCase):
    def test_invalid_thanks_only(self) -> None:
        self.assertTrue(is_likely_stt_hallucination("감사합니다."))

    def test_invalid_repeated_thanks(self) -> None:
        self.assertTrue(is_likely_stt_hallucination("감사합니다. 감사합니다."))

    def test_invalid_youtube_outro(self) -> None:
        self.assertTrue(is_likely_stt_hallucination("시청해주셔서 감사합니다."))

    def test_invalid_short_fillers(self) -> None:
        for text in ("네", "음", "어", ""):
            with self.subTest(text=text):
                self.assertTrue(is_likely_stt_hallucination(text))

    def test_valid_symptom_text(self) -> None:
        self.assertFalse(
            is_likely_stt_hallucination("환자가 숨을 잘 못 쉬고 산소포화도가 낮습니다.")
        )

    def test_valid_chest_pain_text(self) -> None:
        self.assertFalse(
            is_likely_stt_hallucination("가슴 통증이 심하고 식은땀이 납니다.")
        )

    def test_valid_long_sentence_with_thanks_is_not_blocked(self) -> None:
        self.assertFalse(
            is_likely_stt_hallucination(
                "환자가 호흡곤란이 있고 산소포화도가 낮습니다 감사합니다"
            )
        )


if __name__ == "__main__":
    unittest.main()
