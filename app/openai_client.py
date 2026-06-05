from __future__ import annotations

import os
from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()

_cached_client: OpenAI | None = None


def get_openai_client() -> OpenAI:
    global _cached_client
    if _cached_client is None:
        OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
        if not OPENAI_API_KEY:
            raise RuntimeError("OPENAI_API_KEY is not set. Add it to your .env file.")
        _cached_client = OpenAI(api_key=OPENAI_API_KEY)
    return _cached_client
