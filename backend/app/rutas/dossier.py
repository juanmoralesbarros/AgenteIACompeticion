# dossier.py
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, Dict, Any
import os, json

router = APIRouter(prefix="/dossier", tags=["dossier"])

# ===================== Modelos mínimos (solo PDFs) =====================
class FinancieraBlock(BaseModel):
    activosCorrientes: Optional[float] = None
    pasivosCorrientes: Optional[float] = None
    pasivosTotales: Optional[float] = None
    activosTotales: Optional[float] = None
    utilidadNeta: Optional[float] = None
    ventas: Optional[float] = None
    costoVentas: Optional[float] = None
    inventarioPromedio: Optional[float] = None
    flujoCajaOperativo: Optional[float] = None

class DossierOut(BaseModel):
    ruc: Optional[str] = None
    financiera: FinancieraBlock

# ===================== Request =====================
class AggregateInput(BaseModel):
    # hashes de archivos guardados por tus endpoints:
    balance_hash: Optional[str] = None            # -> storage/{hash}.json
    eri_hash: Optional[str] = None                # -> storage/{hash}_eri.json
    efe_hash: Optional[str] = None                # -> storage/{hash}_efe.json

    # Limpieza básica de strings (evita espacios/comillas accidentales)
    def clean(self):
        for k, v in list(self.__dict__.items()):
            if isinstance(v, str):
                self.__dict__[k] = v.strip().strip('"').strip("'")

# ===================== Helpers =====================
def _load_json_or_none(path: str) -> Optional[Dict[str, Any]]:
    """Carga JSON si existe y tiene tamaño > 0. Devuelve None ante cualquier problema."""
    try:
        if os.path.exists(path) and os.path.getsize(path) > 0:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        return None
    except Exception:
        return None

def _storage_dir() -> str:
    # mismo lugar donde guardas en tus endpoints
    return os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "storage"))

def _pick_ruc(balance: Optional[Dict[str, Any]],
              eri: Optional[Dict[str, Any]],
              efe: Optional[Dict[str, Any]]) -> Optional[str]:
    # intenta leer header_meta.ruc en orden: balance, ERI, EFE
    for doc in (balance, eri, efe):
        try:
            ruc = (doc or {}).get("header_meta", {}).get("ruc")
            if ruc:
                return ruc
        except Exception:
            pass
    return None

def _f(x):
    """Castea a float si es posible; si no, devuelve None."""
    try:
        return float(x) if x is not None else None
    except Exception:
        return None

def _map_financiera(balance: Optional[Dict[str, Any]],
                    eri: Optional[Dict[str, Any]],
                    efe: Optional[Dict[str, Any]]) -> FinancieraBlock:
    f = FinancieraBlock()
    inventario_balance = None

    # Balance
    if balance and isinstance(balance.get("fields"), dict):
        bf = balance["fields"]
        f.activosCorrientes = _f(bf.get("activos_corrientes"))
        f.pasivosCorrientes = _f(bf.get("pasivos_corrientes"))
        f.pasivosTotales    = _f(bf.get("pasivos_totales"))
        f.activosTotales    = _f(bf.get("activos_totales"))
        inventario_balance  = _f(bf.get("inventarios"))  # fallback si no hay inv inicial/final en ERI

    # ERI
    inv_inicial = inv_final = None
    if eri and isinstance(eri.get("fields"), dict):
        ef = eri["fields"]
        f.ventas        = _f(ef.get("ventas"))
        f.costoVentas   = _f(ef.get("costo_ventas"))
        f.utilidadNeta  = _f(ef.get("utilidad_neta"))
        # En la versión actual de tus endpoints ERI no guardas inventario_inicial/final.
        # Si más adelante los agregas, quedará soportado:
        inv_inicial     = _f(ef.get("inventario_inicial"))
        inv_final       = _f(ef.get("inventario_final"))

    # inventarioPromedio
    if inv_inicial is not None or inv_final is not None:
        a = inv_inicial or 0.0
        b = inv_final or 0.0
        f.inventarioPromedio = (a + b) / 2.0
    else:
        f.inventarioPromedio = inventario_balance  # puede ser None

    # EFE
    if efe and isinstance(efe.get("fields"), dict):
        cf = efe["fields"]
        f.flujoCajaOperativo = _f(cf.get("flujo_operacion"))

    return f

# ===================== Endpoint =====================
@router.post("/aggregate", response_model=DossierOut)
def aggregate_dossier(body: AggregateInput):
    body.clean()  # normaliza hashes

    storage = _storage_dir()

    bal = _load_json_or_none(os.path.join(storage, f"{body.balance_hash}.json")) if body.balance_hash else None
    eri = _load_json_or_none(os.path.join(storage, f"{body.eri_hash}_eri.json")) if body.eri_hash else None
    efe = _load_json_or_none(os.path.join(storage, f"{body.efe_hash}_efe.json")) if body.efe_hash else None

    if not any([bal, eri, efe]):
        attempted = []
        if body.balance_hash:
            attempted.append(os.path.join(storage, f"{body.balance_hash}.json"))
        if body.eri_hash:
            attempted.append(os.path.join(storage, f"{body.eri_hash}_eri.json"))
        if body.efe_hash:
            attempted.append(os.path.join(storage, f"{body.efe_hash}_efe.json"))
        raise HTTPException(
            status_code=400,
            detail=f"No se encontraron insumos (balance_hash / eri_hash / efe_hash). Intentos: {attempted}"
        )

    financiera = _map_financiera(bal, eri, efe)

    return DossierOut(
        ruc=_pick_ruc(bal, eri, efe),
        financiera=financiera,
    )
