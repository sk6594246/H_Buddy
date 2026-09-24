---
title: Health Buddy
emoji: 🩺
colorFrom: green
colorTo: gray
sdk: docker
app_port: 7860
pinned: false
license: mit
---

# Health Buddy (H_Buddy)

Simple **Health Claim Fact-Checker** – FastAPI backend + Progressive Web App frontend.  
Built as a school / lower-secondary project: no database, simple RAG (FAISS), free Groq LLM.

**Live repo:** https://github.com/sk6594246/H_Buddy

## Features
- Calm chat-style UI with paper aesthetic, example chips, local history
- Upload PDF / image (OCR) or paste text
- RAG over a small curated medical corpus
- Structured verdicts (VERIFIED TRUE → VERIFIED FALSE)
- “Copy for family chat” + JSON export
- Soft rate limit (default 4/day, configurable)
- Single process serves both API + frontend (easy deploy)

## Project structure
```
H_Buddy/
├── backend/
│   ├── main.py          # FastAPI + static frontend serving
│   ├── rag.py           # FAISS RAG
│   ├── llm.py           # Groq LLM (llama-3.1-8b-instant)
│   ├── corpus/          # .txt medical facts
│   └── requirements.txt
├── frontend/            # PWA (html / css / js)
├── Dockerfile           # For Hugging Face Spaces
├── .gitignore
└── README.md
```

## Local run
```bash
cd backend
python -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt

# Free key: https://console.groq.com
export GROQ_API_KEY=your_key_here
# optional
export DAILY_LIMIT=4

uvicorn main:app --reload --host 0.0.0.0 --port 8000
```
Open http://127.0.0.1:8000

## Which AI is used & how to activate

| Item | Value |
|------|--------|
| Provider | **Groq** (free tier) |
| Model | `llama-3.1-8b-instant` |
| Key | `GROQ_API_KEY` environment variable |
| Get key | https://console.groq.com → create API key |

Without the key the app still runs and returns a safe “UNVERIFIED / MIXED” fallback.

## Deploy on Hugging Face Spaces (recommended – 16 GB RAM free)

1. Go to https://huggingface.co/new-space
2. Choose **Docker** as the SDK
3. Connect / select the GitHub repo `sk6594246/H_Buddy`
4. Create the Space
5. In the Space → **Settings** → **Variables and secrets** add:
   - `GROQ_API_KEY` = your free Groq key
   - `DAILY_LIMIT` = `10` (optional)
6. Wait for the build (first time ~5–8 minutes because the embedding model is downloaded)

Your app will be at: `https://huggingface.co/spaces/YOUR_USERNAME/YOUR_SPACE_NAME`

## Alternative: Render / Railway / Fly.io
See previous README versions or platform docs. Free Render (512 MB) is often too small for the embedding model.

## Disclaimer
Educational use only. Not a substitute for professional medical advice.

## License
MIT (feel free to use for school projects).
