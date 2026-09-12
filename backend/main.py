"""
FastAPI backend.
Çalıştırmak için: uvicorn main:app --reload --port 8000
"""

import shutil
import tempfile
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from image_analysis import analyze_image
from music_theory import generate_music

app = FastAPI(title="Görselden Müzik API")

# Geliştirme sırasında her origin'e izin ver; prod'da kendi domain'inizle sınırlayın.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/analyze")
async def analyze(
    file: UploadFile = File(...),
    regenerate: bool = Query(True, description="False ise aynı melodiyi tekrar üretir"),
):
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        raise HTTPException(400, f"Desteklenmeyen dosya türü: {suffix}")

    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        shutil.copyfileobj(file.file, tmp)
        tmp_path = tmp.name

    try:
        features = analyze_image(tmp_path)
        music_params = generate_music(features, regenerate=regenerate)
    finally:
        Path(tmp_path).unlink(missing_ok=True)

    return music_params
