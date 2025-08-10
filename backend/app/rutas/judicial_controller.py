from __future__ import annotations

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field
from typing import List, Dict, Any, Optional, Literal, Tuple
import traceback

from .judicial_scraper import (
    EcuadorJudicialAPI,
    ScrapeResult,
    CausaDetalles,
    kpi_judicial_adapter,
)

# ------------------ Router ------------------
router = APIRouter(prefix="/judicial", tags=["judicial"])
__all__ = ["router"]

# ------------------ DI: cliente API ------------------
def get_api() -> EcuadorJudicialAPI:
    return EcuadorJudicialAPI(timeout=20.0)

# ------------------ Schemas ------------------
class CausaDetallesOut(BaseModel):
    materia: Optional[str]
    fecha: Optional[str]
    hora: Optional[str]
    tipoaccion: Optional[str]
    delito: Optional[str]
    judicatura: Optional[str]
    actorofendido: List[str]
    demandadoprocesado: List[str]
    caso: Optional[str]

class ConsultaMaybeKpiResponse(BaseModel):
    idCaso: str
    general: CausaDetallesOut
    fechaingreso: List[str]
    detalleproceso: List[str]
    payload: Dict[str, Any]
    kpi: Optional[Dict[str, int]] = None  # opcional

class CausaRequest(BaseModel):
    texto: str = Field(..., description="Número de causa, idJuicio o Cédula/RUC/Pasaporte")
    rol: Literal["demandado", "actor"] = Field("demandado", description="Dónde buscar si 'texto' es identidad")
    incluir_kpi: bool = Field(False, description="Si true, agrega KPI judicial en la respuesta")

class IdentidadRequest(BaseModel):
    identificacion: str = Field(..., description="Cédula/RUC/Pasaporte")
    rol: Literal["demandado", "actor"] = Field("demandado")
    page: int = Field(1, ge=1)
    size: int = Field(10, ge=1, le=50)

class CausaResumen(BaseModel):
    idJuicio: str
    numeroCausa: Optional[str] = None
    nombreMateria: Optional[str] = None
    nombreJudicatura: Optional[str] = None
    fechaIngreso: Optional[str] = None  # ISO

class BuscarIdentidadResponse(BaseModel):
    page: int
    size: int
    total: int
    items: List[CausaResumen]

# ===== Nuevos modelos para nómina =====
class RepresentanteIn(BaseModel):
    identificacion: str
    tipo: Optional[Literal["RUC", "CEDULA", "PASAPORTE"]] = None
    nombre: Optional[str] = None
    cargo: Optional[str] = None
    tipoRepresentacion: Optional[str] = None  # p. ej. RL

class NominaRequest(BaseModel):
    empresa_ruc: str = Field(..., description="RUC de la empresa")
    representantes: List[RepresentanteIn] = Field(default_factory=list)
    incluir_kpi: bool = Field(True, description="Si true, agrega KPI por identidad")
    roles: List[Literal["demandado", "actor"]] = Field(
        default_factory=lambda: ["demandado", "actor"],
        description="Roles a consultar para cada identidad"
    )
    page_size: int = Field(50, ge=1, le=50)
    max_pages: int = Field(3, ge=1, le=10, description="Límite de páginas por rol para no matar a CLEX")

class IdentidadResumenOut(BaseModel):
    identificacion: str
    tipo: Optional[str] = None
    nombre: Optional[str] = None
    cargo: Optional[str] = None
    tipoRepresentacion: Optional[str] = None
    total_causas: int
    por_rol: Dict[str, int]
    items: List[CausaResumen]
    kpi: Optional[Dict[str, int]] = None

class NominaResponse(BaseModel):
    empresa: IdentidadResumenOut
    representantes: List[IdentidadResumenOut]

# ------------------ Helpers ------------------
def _to_response(res: ScrapeResult) -> ConsultaMaybeKpiResponse:
    d = res.to_dict()
    return ConsultaMaybeKpiResponse(
        idCaso=d["idCaso"],
        general=CausaDetallesOut(**d["general"]),
        fechaingreso=d["fechaingreso"],
        detalleproceso=d["detalleproceso"],
        payload=d["payload"],
    )

# KPI naive para listas por identidad (sin entrar a cada causa)
def _kpi_from_items(items: List[CausaResumen]) -> Dict[str, int]:
    def match(m: Optional[str], needle: str) -> bool:
        return bool(m and needle.lower() in m.lower())

    total = len(items)
    penal = sum(1 for x in items if match(x.nombreMateria, "penal"))
    laboral = sum(1 for x in items if match(x.nombreMateria, "laboral"))
    transito = sum(1 for x in items if match(x.nombreMateria, "tránsito") or match(x.nombreMateria, "transito"))
    coactiva = sum(1 for x in items if match(x.nombreMateria, "coactiva"))
    contencioso = sum(1 for x in items if match(x.nombreMateria, "contencioso"))
    return {
        "total": total,
        "penal": penal,
        "laboral": laboral,
        "transito": transito,
        "coactiva": coactiva,
        "contencioso": contencioso,
    }

# Paginación por identidad y rol; retorna items y conteo por rol
def _buscar_todo(
    api: EcuadorJudicialAPI,
    ident: str,
    roles: List[str],
    page_size: int,
    max_pages: int,
) -> Tuple[List[CausaResumen], Dict[str, int]]:
    items: List[CausaResumen] = []
    por_rol: Dict[str, int] = {}

    for rol in roles:
        total_contado = 0
        pagina = 1
        while pagina <= max_pages:
            total, page_items_raw = api.buscar_por_identidad(ident, rol=rol, page=pagina, size=page_size)
            # map mínimo
            page_items: List[CausaResumen] = []
            for it in page_items_raw:
                page_items.append(
                    CausaResumen(
                        idJuicio=str(it.get("idJuicio") or ""),
                        numeroCausa=it.get("numeroCausa") or None,
                        nombreMateria=it.get("nombreMateria") or None,
                        nombreJudicatura=it.get("nombreJudicatura") or None,
                        fechaIngreso=it.get("fechaIngreso") or None,
                    )
                )
            items.extend(page_items)
            total_contado += len(page_items)

            # fin de páginas
            if len(page_items_raw) < page_size or total_contado >= total:
                break
            pagina += 1
        por_rol[rol] = total_contado

    return items, por_rol

# Resumen para una identidad
def _resumen_identidad(
    api: EcuadorJudicialAPI,
    ident: str,
    meta: Dict[str, Optional[str]],
    roles: List[str],
    incluir_kpi: bool,
    page_size: int,
    max_pages: int,
) -> IdentidadResumenOut:
    items, por_rol = _buscar_todo(api, ident, roles, page_size, max_pages)
    kpi = _kpi_from_items(items) if incluir_kpi else None
    return IdentidadResumenOut(
        identificacion=ident,
        tipo=meta.get("tipo"),
        nombre=meta.get("nombre"),
        cargo=meta.get("cargo"),
        tipoRepresentacion=meta.get("tipoRepresentacion"),
        total_causas=len(items),
        por_rol=por_rol,
        items=items,
        kpi=kpi,
    )

# ------------------ Endpoints ------------------

@router.get("/health", summary="Healthcheck simple")
def health():
    return {"status": "ok"}

@router.post(
    "/buscar-por-identidad",
    response_model=BuscarIdentidadResponse,
    summary="Lista causas por Cédula/RUC/Pasaporte en Demandado/Procesado (o Actor/Ofendido)",
)
def buscar_por_identidad(req: IdentidadRequest, api: EcuadorJudicialAPI = Depends(get_api)):
    ident = req.identificacion.strip()
    if not ident:
        raise HTTPException(status_code=400, detail="El campo 'identificacion' es obligatorio.")
    try:
        total, items_raw = api.buscar_por_identidad(ident, rol=req.rol, page=req.page, size=req.size)
        items: List[CausaResumen] = []
        for it in items_raw:
            items.append(
                CausaResumen(
                    idJuicio=str(it.get("idJuicio") or ""),
                    numeroCausa=it.get("numeroCausa") or None,
                    nombreMateria=it.get("nombreMateria") or None,
                    nombreJudicatura=it.get("nombreJudicatura") or None,
                    fechaIngreso=it.get("fechaIngreso") or None,
                )
            )
        return BuscarIdentidadResponse(page=req.page, size=req.size, total=total, items=items)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Error buscando causas: {e}")

@router.post(
    "/consulta",
    response_model=ConsultaMaybeKpiResponse,
    summary="Consulta por id/num de causa o por Cédula/RUC/Pasaporte; opcionalmente agrega KPI",
)
def consulta(req: CausaRequest, api: EcuadorJudicialAPI = Depends(get_api)):
    if not req.texto or not req.texto.strip():
        raise HTTPException(status_code=400, detail="El campo 'texto' es obligatorio.")
    try:
        result = api.scrape_por_numero_causa(req.texto.strip(), rol=req.rol)
        base = _to_response(result).model_dump()
        if req.incluir_kpi:
            base["kpi"] = kpi_judicial_adapter(result)
        return ConsultaMaybeKpiResponse(**base)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        tb = traceback.format_exc(limit=2)
        raise HTTPException(status_code=502, detail=f"Error consultando FJ: {e}. {tb}")

# ===== Nuevo: resumen de nómina =====
@router.post(
    "/nomina-resumen",
    response_model=NominaResponse,
    summary="Aplica búsqueda judicial al RUC de la empresa y a cada representante (cédula o RUC)",
)
def nomina_resumen(req: NominaRequest, api: EcuadorJudicialAPI = Depends(get_api)):
    if not req.empresa_ruc or not req.empresa_ruc.strip():
        raise HTTPException(status_code=400, detail="'empresa_ruc' es obligatorio.")

    try:
        # Empresa
        empresa = _resumen_identidad(
            api=api,
            ident=req.empresa_ruc.strip(),
            meta={"tipo": "RUC", "nombre": None, "cargo": None, "tipoRepresentacion": None},
            roles=req.roles,
            incluir_kpi=req.incluir_kpi,
            page_size=req.page_size,
            max_pages=req.max_pages,
        )

        # Representantes
        reps: List[IdentidadResumenOut] = []
        for r in req.representantes:
            meta = {
                "tipo": r.tipo or None,
                "nombre": r.nombre or None,
                "cargo": r.cargo or None,
                "tipoRepresentacion": r.tipoRepresentacion or None,
            }
            reps.append(
                _resumen_identidad(
                    api=api,
                    ident=r.identificacion.strip(),
                    meta=meta,
                    roles=req.roles,
                    incluir_kpi=req.incluir_kpi,
                    page_size=req.page_size,
                    max_pages=req.max_pages,
                )
            )

        return NominaResponse(empresa=empresa, representantes=reps)

    except HTTPException:
        raise
    except Exception as e:
        tb = traceback.format_exc(limit=2)
        raise HTTPException(status_code=502, detail=f"Error generando resumen de nómina: {e}. {tb}")
