"""Local PaddleOCR backend for the existing /api/ocr browser contract."""

import base64
import binascii
import io
import json
import os
import re
import threading
import unicodedata
from collections import deque
from http.server import BaseHTTPRequestHandler, HTTPServer
from time import monotonic

import numpy as np
from PIL import Image, UnidentifiedImageError

os.environ.setdefault("PADDLE_PDX_MODEL_SOURCE", "BOS")

HOST = os.environ.get("OCR_HOST", "127.0.0.1")
PORT = int(os.environ.get("OCR_PORT", "8124"))
MODEL_NAME = os.environ.get("OCR_MODEL_NAME", "PP-OCRv5_server_rec")
MODEL_DIR = os.environ.get("OCR_MODEL_DIR")
ENGINE = os.environ.get("OCR_ENGINE")
ALLOWED_ORIGINS = {
    origin.strip()
    for origin in os.environ.get(
        "OCR_ALLOWED_ORIGINS",
        "http://127.0.0.1:5173,http://localhost:5173,https://ponder-j.github.io",
    ).split(",")
    if origin.strip()
}
MAX_BODY_BYTES = 2 * 1024 * 1024
MAX_IMAGE_BYTES = 1_500_000
MAX_REQUESTS_PER_MINUTE = 30
IMAGE_URL = re.compile(r"^data:image/(?:png|jpeg|jpg);base64,([A-Za-z0-9+/=]+)$")
KANA = re.compile(r"[^\u3040-\u30ff]")
# A one-character kana exercise has no word context. These OCR outputs have
# the same strokes as the corresponding kana, so treat them as that kana.
KANA_LOOKALIKES = {
    "<": "く",
    "/": "ノ",
    "工": "エ",
    "才": "オ",
    "力": "カ",
    "夕": "タ",
    "卜": "ト",
    "二": "ニ",
    "又": "ヌ",
    "八": "ハ",
    "三": "ミ",
    "口": "ロ",
    "七": "セ",
}
model = None
model_lock = threading.Lock()
request_log = {}


def load_model():
    global model
    with model_lock:
        if model is None:
            from paddleocr import TextRecognition

            options = {"model_name": MODEL_NAME, "device": "cpu"}
            if MODEL_DIR:
                options["model_dir"] = MODEL_DIR
            if ENGINE:
                options["engine"] = ENGINE
            print(f"[paddle-ocr] loading {MODEL_NAME} ({ENGINE or 'default engine'})", flush=True)
            model = TextRecognition(**options)
    return model


def allow_request(address):
    now = monotonic()
    recent = request_log.setdefault(address, deque())
    while recent and now - recent[0] >= 60:
        recent.popleft()
    if len(recent) >= MAX_REQUESTS_PER_MINUTE:
        return False
    recent.append(now)
    return True


def prepare_image(data_url):
    if not isinstance(data_url, str):
        raise ValueError("image must be a PNG or JPEG data URL")
    match = IMAGE_URL.fullmatch(data_url)
    if not match:
        raise ValueError("image must be a PNG or JPEG data URL")
    try:
        raw = base64.b64decode(match.group(1), validate=True)
    except binascii.Error as error:
        raise ValueError("invalid base64 image") from error
    if not raw or len(raw) > MAX_IMAGE_BYTES:
        raise ValueError("image payload is empty or too large")

    try:
        image = Image.open(io.BytesIO(raw))
        if image.format not in ("PNG", "JPEG") or image.width * image.height > 4_000_000:
            raise ValueError("invalid image format or dimensions")
        image = image.convert("RGB")
    except (UnidentifiedImageError, OSError) as error:
        raise ValueError("invalid image") from error

    # The browser sends a wide, nearly empty canvas. Crop around the strokes so
    # the recognition-only model sees one character at a useful scale.
    gray = np.asarray(image.convert("L"))
    ink = np.argwhere(gray < 200)
    if ink.size == 0:
        return None
    top, left = ink.min(axis=0)
    bottom, right = ink.max(axis=0) + 1
    margin = max(12, int(max(bottom - top, right - left) * 0.12))
    left = max(0, int(left) - margin)
    top = max(0, int(top) - margin)
    right = min(image.width, int(right) + margin)
    bottom = min(image.height, int(bottom) + margin)
    crop = image.crop((left, top, right, bottom))
    side = max(crop.size)
    square = Image.new("RGB", (side, side), "white")
    square.paste(crop, ((side - crop.width) // 2, (side - crop.height) // 2))
    return np.asarray(square)[:, :, ::-1].copy()


def recognize(data_url):
    image = prepare_image(data_url)
    if image is None:
        return {"text": "", "rawText": "", "confidence": 0}
    result = next(iter(load_model().predict(input=image, batch_size=1)))
    payload = result.json["res"]
    raw_text = str(payload.get("rec_text") or "")
    normalized = unicodedata.normalize("NFKC", raw_text.strip())
    return {
        "text": KANA_LOOKALIKES.get(normalized, KANA.sub("", normalized)),
        "rawText": raw_text,
        "confidence": round(float(payload.get("rec_score") or 0) * 100, 2),
    }


class Handler(BaseHTTPRequestHandler):
    def send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.cors_headers()
        self.end_headers()
        self.wfile.write(body)

    def cors_headers(self):
        origin = self.headers.get("Origin")
        if origin in ALLOWED_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Vary", "Origin")

    def do_OPTIONS(self):
        self.send_response(204)
        self.cors_headers()
        self.end_headers()

    def do_GET(self):
        if self.path == "/healthz":
            self.send_json(200, {"ok": True, "service": "kana-paddle-ocr", "model": MODEL_NAME, "engine": ENGINE or "default"})
        else:
            self.send_json(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/api/ocr":
            self.send_json(404, {"error": "not found"})
            return
        if not allow_request(self.client_address[0]):
            self.send_json(429, {"error": "rate limit exceeded"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > MAX_BODY_BYTES:
                self.send_json(413, {"error": "request body is empty or too large"})
                return
            payload = json.loads(self.rfile.read(length))
            self.send_json(200, recognize(payload.get("image")))
        except (ValueError, json.JSONDecodeError, AttributeError) as error:
            self.send_json(400, {"error": str(error)})
        except Exception as error:
            print(f"[paddle-ocr] recognition failed: {error}", flush=True)
            self.send_json(500, {"error": "OCR service failed"})


if __name__ == "__main__":
    load_model()
    with HTTPServer((HOST, PORT), Handler) as server:
        print(f"[paddle-ocr] listening on http://{HOST}:{PORT}", flush=True)
        server.serve_forever()
