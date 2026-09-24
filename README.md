# HeathBuddy (H_Buddy)

Simple **Health Claim Fact-Checker** – FastAPI backend + Progressive Web App frontend.  
Built as a school / lower-secondary project: no database, simple RAG (FAISS), free Groq LLM.

**Live repo:** https://github.com/sk6594246/H_Buddy

## Features
- Chat UI with dark mode, example chips, history panel
- Upload PDF / image (OCR) or use microphone
- RAG over a small curated medical corpus
- Structured verdicts (VERIFIED TRUE → VERIFIED FALSE)
- Rate limit (default 4/day, configurable)
- Single process serves both API + frontend (easy deploy)

## Project structure
```
H_Buddy/
├── backend/
│   ├── main.py          # FastAPI + static frontend serving
│   ├── rag.py           # FAISS RAG
│   ├── llm.py           # Groq-compatible LLM
│   ├── corpus/          # .txt medical facts
│   └── requirements.txt
├── frontend/            # PWA (html/css/js)
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

Optional OCR: install system Tesseract (`apt install tesseract-ocr` / `brew install tesseract`).

## Deploy (recommended: Render)

1. Go to [render.com](https://render.com) → New → **Web Service**.
2. Connect the `H_Buddy` repository.
3. Settings:
   - **Root Directory:** leave blank
   - **Build Command:**  
     `pip install -r backend/requirements.txt`
   - **Start Command:**  
     `cd backend && uvicorn main:app --host 0.0.0.0 --port $PORT`
   - **Environment:**
     - `GROQ_API_KEY` = your free Groq key
     - `DAILY_LIMIT` = `4` (optional)
4. Deploy. Your app will be at `https://your-service.onrender.com`

### Alternative: Railway / Fly.io
Same idea – set start command to run uvicorn from the `backend` folder and add `GROQ_API_KEY`.

### Note on free tiers
- First request may be slow (cold start + embedding model download).
- OCR (Tesseract) may not be available on all free hosts; text claims still work fully.

## Disclaimer
Educational use only. Not a substitute for professional medical advice.

## License
MIT (feel free to use for school projects).
