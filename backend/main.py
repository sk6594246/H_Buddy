"""
HeathBuddy – FastAPI backend
Simple school-project version:
- Chat endpoint that accepts text or file uploads
- Soft rate limiting (in-memory, resets daily)
- Serves the PWA frontend from the same process (easy deploy)
- No database
"""

import os
from datetime import date
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pypdf import PdfReader
from PIL import Image
import pytesseract
import io

from rag import rag_engine
from llm import get_verdict

# -------------------------------------------------
# Configuration (easy to change for school project)
# -------------------------------------------------
DAILY_LIMIT = int(os.getenv("DAILY_LIMIT", "4"))  # default 4 claims per day
_rate_counter = {"date": str(date.today()), "count": 0}

# Frontend lives next to backend/ (../frontend)
FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"

app = FastAPI(
    title="HeathBuddy",
    description="Simple Health Claim Fact-Checker Engine (school project)",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _check_rate_limit() -> None:
    """Soft daily rate limit (resets when the date changes)."""
    today = str(date.today())
    if _rate_counter["date"] != today:
        _rate_counter["date"] = today
        _rate_counter["count"] = 0

    if _rate_counter["count"] >= DAILY_LIMIT:
        raise HTTPException(
            status_code=429,
            detail=f"Daily limit of {DAILY_LIMIT} claims reached. Try again tomorrow or change DAILY_LIMIT.",
        )
    _rate_counter["count"] += 1


def _extract_text_from_pdf(file_bytes: bytes) -> str:
    reader = PdfReader(io.BytesIO(file_bytes))
    text = ""
    for page in reader.pages:
        text += page.extract_text() or ""
    return text.strip()


def _extract_text_from_image(file_bytes: bytes) -> str:
    image = Image.open(io.BytesIO(file_bytes))
    text = pytesseract.image_to_string(image)
    return text.strip()


# ---------- API routes (defined first so they win over static catch-all) ----------

@app.post("/check")
async def check_claim(
    claim: Optional[str] = Form(None),
    file: Optional[UploadFile] = File(None),
):
    """
    Main endpoint.
    - Send form field "claim" with text, OR
    - Upload a file (pdf / jpg / png). Voice uses browser speech API.
    """
    _check_rate_limit()

    final_claim = (claim or "").strip()

    if file is not None:
        content_type = (file.content_type or "").lower()
        file_bytes = await file.read()
        filename = (file.filename or "").lower()

        if "pdf" in content_type or filename.endswith(".pdf"):
            extracted = _extract_text_from_pdf(file_bytes)
            final_claim = extracted or final_claim
        elif any(x in content_type for x in ["image", "jpeg", "jpg", "png"]) or \
             filename.endswith((".jpg", ".jpeg", ".png")):
            extracted = _extract_text_from_image(file_bytes)
            final_claim = extracted or final_claim
        else:
            raise HTTPException(
                status_code=400,
                detail="For voice or video please use the browser microphone button or paste the transcript as text.",
            )

    if not final_claim:
        raise HTTPException(status_code=400, detail="Please provide a claim (text or supported file).")

    retrieved = rag_engine.retrieve(final_claim)
    chunks = [chunk for chunk, src, dist in retrieved]

    result = await get_verdict(final_claim, chunks)
    result["disclaimer"] = (
        "This information is for educational purposes only and does not substitute for professional medical advice."
    )
    return JSONResponse(content=result)


@app.get("/health")
async def health():
    return {"status": "ok", "date": str(date.today()), "claims_used_today": _rate_counter["count"]}


@app.get("/api/status")
async def api_status():
    return {
        "message": "HeathBuddy API is running",
        "daily_limit": DAILY_LIMIT,
        "claims_used_today": _rate_counter["count"],
    }


# ---------- Frontend (PWA) ----------

@app.get("/")
async def serve_index():
    index = FRONTEND_DIR / "index.html"
    if index.exists():
        return FileResponse(index)
    return {"message": "Frontend not found. API is running.", "docs": "/docs"}


@app.get("/{filename:path}")
async def serve_frontend_asset(filename: str):
    """Serve CSS, JS, manifest, service worker, etc."""
    # Safety: never serve parent paths
    if ".." in filename or filename.startswith("/"):
        raise HTTPException(status_code=404)
    candidate = FRONTEND_DIR / filename
    if candidate.is_file():
        return FileResponse(candidate)
    raise HTTPException(status_code=404, detail="Not found")
