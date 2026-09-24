"""
Simple FAISS-based RAG for HeathBuddy.
Loads all .txt files from the corpus/ folder, splits them into smaller chunks,
embeds them, and retrieves top-k chunks.
Designed to be beginner-friendly and run entirely in memory (no database).
"""

from pathlib import Path
from typing import List, Tuple

import numpy as np
import faiss
from sentence_transformers import SentenceTransformer

CORPUS_DIR = Path(__file__).parent / "corpus"
EMBEDDING_MODEL_NAME = "all-MiniLM-L6-v2"
TOP_K = 4
CHUNK_SIZE = 400
CHUNK_OVERLAP = 80


def _split_text(text: str, size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> List[str]:
    if len(text) <= size:
        return [text]
    chunks = []
    start = 0
    while start < len(text):
        end = start + size
        chunks.append(text[start:end].strip())
        start += size - overlap
    return [c for c in chunks if c]


class SimpleRAG:
    def __init__(self):
        print("Loading embedding model (first run may download ~80 MB)...")
        self.model = SentenceTransformer(EMBEDDING_MODEL_NAME)
        self.chunks: List[str] = []
        self.sources: List[str] = []
        self.index = None
        self._build_index()

    def _load_corpus(self) -> None:
        self.chunks = []
        self.sources = []
        if not CORPUS_DIR.exists():
            print(f"Warning: corpus folder {CORPUS_DIR} not found.")
            return
        for file_path in sorted(CORPUS_DIR.glob("*.txt")):
            text = file_path.read_text(encoding="utf-8").strip()
            if not text:
                continue
            parts = _split_text(text)
            for part in parts:
                self.chunks.append(part)
                self.sources.append(file_path.name)
            print(f"  Loaded: {file_path.name} → {len(parts)} chunk(s)")

    def _build_index(self) -> None:
        self._load_corpus()
        if not self.chunks:
            print("No corpus loaded – RAG will return empty results.")
            self.index = faiss.IndexFlatL2(384)
            return
        print("Creating embeddings...")
        embeddings = self.model.encode(self.chunks, show_progress_bar=False)
        embeddings = np.array(embeddings).astype("float32")
        dimension = embeddings.shape[1]
        self.index = faiss.IndexFlatL2(dimension)
        self.index.add(embeddings)
        print(f"FAISS index ready with {len(self.chunks)} chunks.")

    def retrieve(self, query: str, top_k: int = TOP_K) -> List[Tuple[str, str, float]]:
        if self.index is None or len(self.chunks) == 0:
            return []
        query_vec = self.model.encode([query]).astype("float32")
        distances, indices = self.index.search(query_vec, min(top_k, len(self.chunks)))
        results = []
        for dist, idx in zip(distances[0], indices[0]):
            if idx < 0:
                continue
            results.append((self.chunks[idx], self.sources[idx], float(dist)))
        return results


rag_engine = SimpleRAG()
