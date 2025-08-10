# app/rutas/sri_controller.py
from __future__ import annotations
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import Any, Dict, Optional
import os, re
import requests
from requests.adapters import HTTPAdapter, Retry
from datetime import datetime

SRI_BASE = os.getenv(
    "SRI_BASE_URL",
    "https://srienlinea.sri.gob.ec/sri-catastro-sujeto-servicio-internet"
).rstrip("/")

router = APIRouter(prefix="/sri", tags=["SRI"])

def _session(timeout: float = 15.0) -> requests.Session:
    s = requests.Session()
    retries = Retry(
        total=3, backoff_factor=0.4,
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=frozenset(["GET"])
    )
    s.mount("https://", HTTPAdapter(max_retries=retries))
    s.headers.update({
        "Accept": "application/json, text/plain, */*",
        "User-Agent": "Mozilla/5.0",
    })
    s.timeout = timeout  # nota: no es nativo, pasamos timeout en cada req
    return s

def _parse_bool_text(s: str) -> Optional[bool]:
    t = s.strip().lower()
    if t in ("true", "1", "si", "sí"): return True
    if t in ("false", "0", "no"): return False
    return None

def _to_iso(dt_str: Optional[str]) -> Optional[str]:
    if not dt_str: return None
    # "2002-07-31 15:27:29.0" -> ISO
    dt_str = dt_str.replace(".0", "")
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            d = datetime.strptime(dt_str, fmt)
            return d.strftime("%Y-%m-%d")
        except Exception:
            continue
    try:
        return datetime.fromisoformat(dt_str).date().isoformat()
    except Exception:
        return None

class ExistsOut(BaseModel):
    ruc: str
    exists: bool

class ContribuyenteOut(BaseModel):
    ruc: str
    existe: bool
    data: Optional[Dict[str, Any]] = None

@router.get("/exists", response_model=ExistsOut, summary="Valida existencia de RUC en SRI")
def exists(ruc: str = Query(..., min_length=10, max_length=13)):
    url = f"{SRI_BASE}/rest/ConsolidadoContribuyente/existePorNumeroRuc?numeroRuc={ruc}"
    s = _session()
    try:
        res = s.get(url, timeout=10)
        res.raise_for_status()
        ctype = res.headers.get("content-type","")
        if "application/json" in ctype:
            # algunos entornos responden boolean JSON
            data = res.json()
            if isinstance(data, bool):
                return ExistsOut(ruc=ruc, exists=data)
            # o en objeto {exists:true}
            if isinstance(data, dict):
                val = data.get("exists")
                if isinstance(val, bool):
                    return ExistsOut(ruc=ruc, exists=val)
        # fallback: texto "true"/"false"
        text = res.text
        b = _parse_bool_text(text)
        if b is None:
            raise HTTPException(status_code=502, detail=f"Formato inesperado de SRI: {text[:120]}")
        return ExistsOut(ruc=ruc, exists=b)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"SRI exists error: {e}")

@router.get("/contribuyente", response_model=ContribuyenteOut, summary="Datos básicos del RUC en SRI")
def contribuyente(ruc: str = Query(..., min_length=10, max_length=13)):
    url = f"{SRI_BASE}/rest/ConsolidadoContribuyente/obtenerPorNumerosRuc?&ruc={ruc}"
    s = _session()
    try:
        res = s.get(url, timeout=12)
        res.raise_for_status()
        data = res.json()
        if not isinstance(data, list) or not data:
            return ContribuyenteOut(ruc=ruc, existe=False, data=None)
        item = data[0]
        # normalizaciones útiles para tus KPIs
        info = item.get("informacionFechasContribuyente") or {}
        item["fechaInicioISO"] = _to_iso(info.get("fechaInicioActividades"))
        obligado = item.get("obligadoLlevarContabilidad","").strip().upper()
        item["obligadoBool"] = True if obligado == "SI" or obligado == "SÍ" else False if obligado == "NO" else None
        return ContribuyenteOut(ruc=ruc, existe=True, data=item)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"SRI contribuyente error: {e}")

sri_router = router
