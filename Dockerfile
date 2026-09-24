# Hugging Face Spaces – FastAPI Health Buddy
FROM python:3.11-slim

WORKDIR /app

# System deps (optional OCR support)
RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr \
    && rm -rf /var/lib/apt/lists/*

# Copy backend first for better layer caching
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the whole project
COPY backend/ ./backend/
COPY frontend/ ./frontend/

# Hugging Face Spaces expects the app on port 7860
ENV PORT=7860
EXPOSE 7860

# Pre-download the embedding model at build time (avoids timeout on first request)
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('all-MiniLM-L6-v2')"

WORKDIR /app/backend
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "7860"]
