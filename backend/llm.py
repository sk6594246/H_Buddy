"""
LLM wrapper for Health Buddy.
Uses a free Groq-compatible API (set GROQ_API_KEY environment variable).
Forces the model to return the exact JSON schema required by the project.
"""

import os
import json
from typing import List, Dict, Any

import httpx
from dotenv import load_dotenv

load_dotenv()

GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"
MODEL_NAME = "llama-3.1-8b-instant"  # fast & free-tier friendly


SYSTEM_PROMPT = """You are Health Buddy, a careful medical fact-checking assistant.
You MUST follow these rules exactly:

1. Base every answer ONLY on the provided retrieved evidence and well-established public health consensus (WHO, CDC, NHS).
2. Never invent studies, authors, or journal names.
3. Choose exactly ONE verdict from this list:
   - VERIFIED TRUE
   - MOSTLY TRUE
   - UNVERIFIED / MIXED
   - MOSTLY FALSE
   - VERIFIED FALSE
4. Return ONLY valid JSON with this exact structure (no markdown, no extra text):

{
  "claim": "<restatement of the claim>",
  "verdict": "<one of the five tags>",
  "confidence_score": <float between 0.0 and 1.0>,
  "summary": "<1-2 sentence explanation suitable for messaging apps>",
  "detailed_breakdown": ["<bullet 1>", "<bullet 2>", "..."],
  "trusted_sources": [
    {
      "organization": "<name>",
      "topic_or_guideline": "<short title>",
      "url": "<real official URL or placeholder https://www.who.int>"
    }
  ],
  "disclaimer": "This information is for educational purposes only and does not substitute for professional medical advice."
}

Keep the tone neutral, empathetic, and easy for a family member to understand.
"""


def build_user_prompt(claim: str, retrieved_chunks: List[str]) -> str:
    evidence = "\n\n---\n\n".join(retrieved_chunks) if retrieved_chunks else "No specific documents retrieved."
    return f"""Claim to check:
{claim}

Retrieved evidence from curated medical corpus:
{evidence}

Now produce the JSON response following the system rules."""


async def get_verdict(claim: str, retrieved_chunks: List[str]) -> Dict[str, Any]:
    """
    Call the free cloud LLM and return a parsed dict.
    Falls back to a safe default if the API key is missing or the call fails.
    """
    if not GROQ_API_KEY:
        return _fallback_response(claim, "GROQ_API_KEY not set. Please add your free Groq API key.")

    payload = {
        "model": MODEL_NAME,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": build_user_prompt(claim, retrieved_chunks)},
        ],
        "temperature": 0.2,
        "max_tokens": 800,
        "response_format": {"type": "json_object"},
    }

    headers = {
        "Authorization": f"Bearer {GROQ_API_KEY}",
        "Content-Type": "application/json",
    }

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(GROQ_API_URL, json=payload, headers=headers)
            resp.raise_for_status()
            data = resp.json()
            content = data["choices"][0]["message"]["content"]
            return json.loads(content)
    except Exception as e:
        return _fallback_response(claim, f"LLM call failed: {str(e)}")


def _fallback_response(claim: str, reason: str) -> Dict[str, Any]:
    """Safe response when the LLM is unavailable."""
    return {
        "claim": claim,
        "verdict": "UNVERIFIED / MIXED",
        "confidence_score": 0.3,
        "summary": f"Could not fully verify this claim right now ({reason}). Please try again later or consult a trusted health source.",
        "detailed_breakdown": [
            "The system could not reach the language model.",
            f"Reason: {reason}",
            "Please check official sources such as WHO or CDC for the most reliable information.",
        ],
        "trusted_sources": [
            {
                "organization": "World Health Organization",
                "topic_or_guideline": "Health topics",
                "url": "https://www.who.int",
            }
        ],
        "disclaimer": "This information is for educational purposes only and does not substitute for professional medical advice.",
    }
