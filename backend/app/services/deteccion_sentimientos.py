# app/services/deteccion_sentimientos_hf.py
from __future__ import annotations
from typing import List, Dict, Any, Optional
import os, time, json
import requests

HF_API_URL = "https://api-inference.huggingface.co/models"
MODEL_REPO = os.getenv("SENT_MODEL_NAME", "cardiffnlp/twitter-xlm-roberta-base-sentiment")
HF_TOKEN = "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"
DEBUG = bool(int(os.getenv("SENT_DEBUG", "1")))  # activa/desactiva logs

if not HF_TOKEN:
    raise RuntimeError("Falta HF_API_TOKEN en el entorno para usar la Inference API.")

# Mapeo robusto a etiquetas humanas (ES)
_LABEL_MAP = {
    # formatos cortos
    "POS": "positivo", "NEG": "negativo", "NEU": "neutro",
    # comunes en muchos modelos
    "POSITIVE": "positivo", "NEGATIVE": "negativo", "NEUTRAL": "neutro",
    # formatos LABEL_i usados a veces por HF
    "LABEL_2": "positivo", "LABEL_1": "neutro", "LABEL_0": "negativo",
}

def _mask_token(tok: str) -> str:
    if not tok: return ""
    return tok[:6] + "…" + tok[-4:]

def _debug(msg: str):
    if DEBUG:
        print(f"[SENT] {msg}")

def _normalize_predictions(data, expected_n):
    """
    Devuelve una lista de dicts top-1 (len == expected_n),
    normalizando distintas formas de respuesta de la API.
    """
    out = []

    # Caso A: List[Dict] -> ya es top-1 por input
    if isinstance(data, list) and all(isinstance(x, dict) for x in data):
        out = data

    # Caso B: List[List[Dict]] (por clase o por input)
    elif isinstance(data, list) and all(isinstance(x, list) for x in data):
        # B1: List[List[Dict (por clase)]] normal
        if len(data) == expected_n and all(data[i] and isinstance(data[i][0], dict) for i in range(len(data))):
            for per_input in data:
                out.append(max(per_input, key=lambda d: d.get("score", 0.0)))
        # B2: Variante “rara”: un solo inner list con top-1 de todos
        elif len(data) == 1 and all(isinstance(x, dict) for x in data[0]):
            out = data[0]
        else:
            # Fallback: intenta sacar top-1 por cada inner list
            for per_input in data:
                if isinstance(per_input, list) and per_input and isinstance(per_input[0], dict):
                    out.append(max(per_input, key=lambda d: d.get("score", 0.0)))

    # Ajuste final: pad/trim para que coincida con expected_n
    if len(out) < expected_n:
        out += [{"label": None, "score": None}] * (expected_n - len(out))
    elif len(out) > expected_n:
        out = out[:expected_n]

    return out


def _post_inference(texts: List[str], max_retries: int = 3) -> List[Dict[str, Any]]:
    """Llama a la Inference API en batch y devuelve top-1 por texto."""
    url = f"{HF_API_URL}/{MODEL_REPO}"
    headers = {"Authorization": f"Bearer {HF_TOKEN}"}
    payload = {
        "inputs": texts,
        "options": {"wait_for_model": True},
        "parameters": {"return_all_scores": True}  # fuerza salida estándar
    }

    for attempt in range(1, max_retries + 1):
        r = requests.post(url, headers=headers, json=payload, timeout=60)
        _debug(f"POST {url}  status={r.status_code}  attempt={attempt}/{max_retries}")
        if r.status_code == 200:
            break
        if r.status_code in (503, 429) and attempt < max_retries:
            backoff = 1.5 ** attempt
            _debug(f"Transient {r.status_code}, retrying in {backoff:.1f}s…")
            time.sleep(backoff)
            continue
        raise RuntimeError(f"Inference API error {r.status_code}: {r.text}")

    data = r.json()
    if isinstance(data, dict) and data.get("error"):
        raise RuntimeError(f"Inference API error payload: {data.get('error')}")

    if DEBUG:
        try:
            preview = json.dumps(data[:1], ensure_ascii=False)[:500]
        except Exception:
            preview = str(data)[:500]
        _debug(f"response preview: {preview}")

    # Normalizar cualquier formato de respuesta
    preds_top1 = _normalize_predictions(data, expected_n=len(texts))
    return preds_top1


def _map_label(raw: Optional[str]) -> Optional[str]:
    if not raw:
        return None
    key = str(raw).upper().strip()
    # intenta directo
    if key in _LABEL_MAP:
        return _LABEL_MAP[key]
    # fallback: primeras 3 letras (POS/NEG/NEU)
    short = key[:3]
    return _LABEL_MAP.get(short, None)

def analyze_texts(texts: List[Optional[str]], batch_size: int = 32) -> List[Dict[str, Any]]:
    """
    Entrada: lista de textos (pueden ser None o vacíos).
    Salida: [{"label": "negativo|neutro|positivo|None", "score": float|None}, ...]
    """
    _debug(f"Modelo='{MODEL_REPO}'  Token={_mask_token(HF_TOKEN)}  batch_size={batch_size}")
    # Normaliza entradas
    cleaned: List[Optional[str]] = [
        (t.strip() if isinstance(t, str) else None) for t in texts
    ]
    out = [{"label": None, "score": None} for _ in cleaned]

    # índices con texto válido
    idx = [i for i, t in enumerate(cleaned) if t]
    if not idx:
        _debug("No hay textos válidos tras limpieza; retornando todo None.")
        return out

    # logging de ejemplo de inputs (sin datos sensibles)
    if DEBUG:
        sample_in = [cleaned[i][:120] for i in idx[:3]]
        _debug(f"inputs sample (trimmed): {sample_in}")

    # Enviar en lotes
    for start in range(0, len(idx), batch_size):
        group = idx[start:start + batch_size]
        to_send = [cleaned[i] for i in group]
        preds = _post_inference(to_send)  # [{"label":"positive", "score":...}, ...]

        for i_local, pred in enumerate(preds):
            raw = (pred or {}).get("label")
            score = (pred or {}).get("score")
            mapped = _map_label(raw)
            out[group[i_local]] = {
                "label": mapped,
                "score": float(score) if score is not None else None
            }

    return out

def analyze_text(text: Optional[str]) -> Dict[str, Any]:
    return analyze_texts([text])[0]
