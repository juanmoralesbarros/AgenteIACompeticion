# judicial_scraper.py
# Lógica de consumo de la Función Judicial (EC) para KPIs.
# No guarda en DB ni expone API; solo funciones puras y un cliente HTTP reutilizable.

from __future__ import annotations

import re
from dataclasses import dataclass, asdict
from typing import List, Optional, Tuple, Dict, Any, Literal
from datetime import datetime
import requests
from requests.adapters import HTTPAdapter, Retry


# --------------------------- Utilidades ---------------------------

TAG_RE = re.compile(r"<[^>]*>")

def clean_html(raw_html: str) -> str:
    """Elimina etiquetas HTML y colapsa espacios."""
    if not isinstance(raw_html, str):
        return ""
    return re.sub(r"\s+", " ", TAG_RE.sub("", raw_html)).strip()

def _parse_iso_dt(s: Optional[str]) -> Tuple[Optional[str], Optional[str]]:
    """Intenta parsear un datetime y devuelve (YYYY-MM-DD, HH:MM)."""
    if not s:
        return None, None
    for fmt in ("%Y-%m-%dT%H:%M:%S.%f%z", "%Y-%m-%dT%H:%M:%S%z",
                "%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S"):
        try:
            dt = datetime.strptime(s, fmt)
            return dt.strftime("%Y-%m-%d"), dt.strftime("%H:%M")
        except Exception:
            continue
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        return dt.strftime("%Y-%m-%d"), dt.strftime("%H:%M")
    except Exception:
        return None, None

def _parse_dt_obj(s: Optional[str]) -> Optional[datetime]:
    """Devuelve datetime o None, útil para ordenar por fechaIngreso."""
    if not s:
        return None
    for fmt in ("%Y-%m-%dT%H:%M:%S.%f%z", "%Y-%m-%dT%H:%M:%S%z",
                "%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S"):
        try:
            return datetime.strptime(s, fmt)
        except Exception:
            continue
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except Exception:
        return None


# --------------------------- Modelos ---------------------------

@dataclass
class CausaDetalles:
    materia: Optional[str]
    fecha: Optional[str]
    hora: Optional[str]
    tipoaccion: Optional[str]
    delito: Optional[str]
    judicatura: Optional[str]
    actorofendido: List[str]
    demandadoprocesado: List[str]
    caso: Optional[str]  # idJuicio

@dataclass
class ScrapeResult:
    id_caso: str
    detalles: CausaDetalles
    fechas_ingreso: List[str]
    detalles_proceso: List[str]
    payload_actuaciones: Dict[str, Any]

    def to_dict(self) -> Dict[str, Any]:
        return {
            "idCaso": self.id_caso,
            "general": asdict(self.detalles),
            "fechaingreso": self.fechas_ingreso,
            "detalleproceso": self.detalles_proceso,
            "payload": self.payload_actuaciones,
        }


# --------------------------- Cliente HTTP ---------------------------

class EcuadorJudicialAPI:
    BASE_SVC = "https://api.funcionjudicial.gob.ec/EXPEL-CONSULTA-CAUSAS-SERVICE/api/consulta-causas/informacion"
    BASE_CLEX = "https://api.funcionjudicial.gob.ec/EXPEL-CONSULTA-CAUSAS-CLEX-SERVICE/api/consulta-causas-clex/informacion"

    def __init__(self, timeout: float = 15.0):
        self.session = requests.Session()
        # No reintentar 500: ese backend devuelve 500 por tonterías. Reintentar 429/502/503/504.
        retries = Retry(
            total=3,
            backoff_factor=0.5,
            status_forcelist=(429, 502, 503, 504),
            allowed_methods=frozenset(["GET", "POST"]),
        )
        self.session.mount("https://", HTTPAdapter(max_retries=retries))
        self.timeout = timeout

        self.common_headers = {
            "Accept": "application/json, text/plain, */*",
            "Origin": "https://procesosjudiciales.funcionjudicial.gob.ec",
            "Referer": "https://procesosjudiciales.funcionjudicial.gob.ec/",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                          "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        }

    # ----------------------- Endpoints crudos -----------------------

    def buscar_causa_id(self, texto: str) -> Optional[str]:
        """POST /buscarCausas: devuelve idJuicio si el texto coincide por id o número de causa."""
        url = f"{self.BASE_SVC}/buscarCausas?page=1&size=10"
        payload = {
            "numeroCausa": texto,
            "actor": {"cedulaActor": "", "nombreActor": ""},
            "demandado": {"cedulaDemandado": "", "nombreDemandado": ""},
            "first": 1,
            "numeroFiscalia": "",
            "pageSize": 10,
            "provincia": "",
            "recaptcha": "verdad",
        }
        headers = {**self.common_headers, "Content-Type": "application/json"}
        resp = self.session.post(url, headers=headers, json=payload, timeout=self.timeout)
        if 500 <= resp.status_code < 600:
            return None
        resp.raise_for_status()
        data = resp.json()

        bucket = data if isinstance(data, list) else data.get("content") if isinstance(data, dict) else None
        if not isinstance(bucket, list):
            return None

        for item in bucket:
            try:
                if str(item.get("idJuicio")) == str(texto) or str(item.get("numeroCausa")) == str(texto):
                    return str(item.get("idJuicio"))
            except Exception:
                continue
        return None

    def buscar_por_identidad(self, identificacion: str, rol: Literal["demandado","actor"]="demandado",
                             page: int = 1, size: int = 20) -> Tuple[int, List[Dict[str, Any]]]:
        """POST /buscarCausas filtrando por cédula/RUC/pasaporte en demandado o actor. Devuelve (total, items)."""
        url = f"{self.BASE_SVC}/buscarCausas?page={page}&size={size}"
        payload = {
            "numeroCausa": "",
            "actor": {"cedulaActor": identificacion if rol == "actor" else "", "nombreActor": ""},
            "demandado": {"cedulaDemandado": identificacion if rol == "demandado" else "", "nombreDemandado": ""},
            "first": page,
            "numeroFiscalia": "",
            "pageSize": size,
            "provincia": "",
            "recaptcha": "verdad",
        }
        headers = {**self.common_headers, "Content-Type": "application/json"}
        resp = self.session.post(url, headers=headers, json=payload, timeout=self.timeout)
        if 500 <= resp.status_code < 600:
            return 0, []
        resp.raise_for_status()
        data = resp.json()
        if isinstance(data, list):
            return len(data), data
        if isinstance(data, dict) and isinstance(data.get("content"), list):
            total = int(data.get("totalElements") or len(data["content"]))
            return total, data["content"]
        return 0, []

    def get_incidente_judicatura(self, id_juicio: str) -> Optional[dict]:
        """GET CLEX getIncidenteJudicatura/{idJuicio}. Tolera 5xx devolviendo None."""
        url = f"{self.BASE_CLEX}/getIncidenteJudicatura/{id_juicio}"
        try:
            resp = self.session.get(url, headers=self.common_headers, timeout=self.timeout)
            if 500 <= resp.status_code < 600:
                return None
            resp.raise_for_status()
            data = resp.json()
            return data[0] if isinstance(data, list) and data else None
        except requests.RequestException:
            return None

    def get_informacion_juicio(self, id_juicio: str) -> Optional[dict]:
        """GET SVC getInformacionJuicio/{idJuicio}. Tolera 5xx devolviendo None."""
        url = f"{self.BASE_SVC}/getInformacionJuicio/{id_juicio}"
        try:
            resp = self.session.get(url, headers=self.common_headers, timeout=self.timeout)
            if 500 <= resp.status_code < 600:
                return None
            resp.raise_for_status()
            data = resp.json()
            return data[0] if isinstance(data, list) and data else None
        except requests.RequestException:
            return None

    def post_actuaciones(self, payload: dict) -> List[dict]:
        """POST SVC actuacionesJudiciales. Si falla, devuelve lista vacía."""
        url = f"{self.BASE_SVC}/actuacionesJudiciales"
        headers = {**self.common_headers, "Content-Type": "application/json"}
        try:
            resp = self.session.post(url, headers=headers, json=payload, timeout=self.timeout)
            if 500 <= resp.status_code < 600:
                return []
            resp.raise_for_status()
            data = resp.json()
            return data if isinstance(data, list) else []
        except requests.RequestException:
            return []

    # ----------------------- Orquestación -----------------------

    _CEDULA = re.compile(r"^\d{10}$")
    _RUC    = re.compile(r"^\d{13}$")
    _PASAP  = re.compile(r"^[A-Z0-9]{6,12}$", re.I)

    @staticmethod
    def _looks_identidad(s: str) -> bool:
        return bool(EcuadorJudicialAPI._CEDULA.match(s) or
                    EcuadorJudicialAPI._RUC.match(s) or
                    EcuadorJudicialAPI._PASAP.match(s))

    def _resolver_idjuicio(self, texto: str, rol: Literal["demandado","actor"]="demandado") -> Tuple[str, Optional[Dict[str,Any]]]:
        """
        Si 'texto' parece cédula/RUC/pasaporte: usa buscar_por_identidad, toma la causa más reciente y retorna (idJuicio, item).
        Si no: intenta mapear con buscar_causa_id; si no hay match, usa el texto tal cual como idJuicio.
        """
        t = (texto or "").strip()
        if not t:
            raise ValueError("El campo 'texto' es obligatorio.")

        if self._looks_identidad(t):
            total, items = self.buscar_por_identidad(t, rol=rol, page=1, size=20)
            if not items:
                raise ValueError(f"No se encontraron causas para la identificación '{t}' ({rol}).")
            items_sorted = sorted(items, key=lambda it: (_parse_dt_obj(it.get("fechaIngreso")) or datetime.min), reverse=True)
            sel = items_sorted[0]
            idj = str(sel.get("idJuicio") or "").strip()
            if not idj:
                raise ValueError(f"No se pudo resolver un idJuicio para '{t}'.")
            return idj, sel

        # No es identidad → intenta resolver por número de causa o id
        try:
            found = self.buscar_causa_id(t)
            if found:
                return found, None
        except Exception:
            pass
        # último recurso: usar tal cual
        return t, None

    def scrape_por_numero_causa(self, texto: str, rol: Literal["demandado","actor"]="demandado") -> ScrapeResult:
        """
        Orquesta:
        1) Resolver idJuicio a partir de número de causa/idJuicio o cédula/RUC/pasaporte.
        2) get_incidente_judicatura + get_informacion_juicio (tolerante a 5xx)
        3) post_actuaciones
        4) Devuelve ScrapeResult listo para KPIs
        """
        id_juicio, pre_item = self._resolver_idjuicio(texto, rol=rol)

        info_clex = self.get_incidente_judicatura(id_juicio)
        info_svc  = self.get_informacion_juicio(id_juicio)

        judicatura = info_clex.get("nombreJudicatura") if info_clex else (pre_item or {}).get("nombreJudicatura")
        materia    = (info_svc or {}).get("nombreMateria") or (pre_item or {}).get("nombreMateria")
        tipoaccion = (info_svc or {}).get("nombreTipoAccion") or (pre_item or {}).get("nombreTipoAccion")
        delito     = (info_svc or {}).get("nombreDelito") or (pre_item or {}).get("nombreDelito")
        fechaOrig  = (info_svc or {}).get("fechaIngreso") or (pre_item or {}).get("fechaIngreso")
        fecha, hora = _parse_iso_dt(fechaOrig)

        actorofendido: List[str] = []
        demandadoprocesado: List[str] = []

        if info_clex and isinstance(info_clex.get("lstIncidenteJudicatura"), list):
            for inc in info_clex["lstIncidenteJudicatura"]:
                for a in inc.get("lstLitiganteActor", []) or []:
                    nombre = a.get("nombresLitigante") or ""
                    if nombre: actorofendido.append(clean_html(nombre))
                for d in inc.get("lstLitiganteDemandado", []) or []:
                    nombre = d.get("nombresLitigante") or ""
                    if nombre: demandadoprocesado.append(clean_html(nombre))

        payload = {
            "aplicativo": "web",
            "idIncidenteJudicatura": (
                info_clex.get("lstIncidenteJudicatura", [{}])[0].get("idIncidenteJudicatura")
                if info_clex else None
            ),
            "idJudicatura": info_clex.get("idJudicatura") if info_clex else None,
            "idJuicio": id_juicio,
            "idMovimientoJuicioIncidente": (
                info_clex.get("lstIncidenteJudicatura", [{}])[0].get("idMovimientoJuicioIncidente")
                if info_clex else None
            ),
            "incidente": 1,
            "nombreJudicatura": judicatura,
        }

        actuaciones = self.post_actuaciones(payload)

        fechas_ingreso: List[str] = []
        detalles_proceso: List[str] = []
        for act in actuaciones:
            f = act.get("fecha")
            dt, _ = _parse_iso_dt(f) if f else (None, None)
            if dt:
                try:
                    ddmmyyyy = datetime.strptime(dt, "%Y-%m-%d").strftime("%d-%m-%Y")
                    fechas_ingreso.append(ddmmyyyy)
                except Exception:
                    pass
            tipo = act.get("tipo")
            if isinstance(tipo, str) and tipo.strip():
                detalles_proceso.append(tipo.strip())

        # Fallback: si no conseguimos fecha arriba, intenta derivarla de actuaciones
        if fecha is None and actuaciones:
            candidates = []
            for act in actuaciones:
                d, _ = _parse_iso_dt(act.get("fecha"))
                if d: candidates.append(d)
            if candidates:
                fecha = sorted(candidates)[0]  # la más antigua como aprox. fecha de ingreso

        detalles = CausaDetalles(
            materia=materia,
            fecha=fecha,
            hora=hora,
            tipoaccion=tipoaccion,
            delito=delito,
            judicatura=judicatura,
            actorofendido=actorofendido,
            demandadoprocesado=demandadoprocesado,
            caso=id_juicio
        )

        return ScrapeResult(
            id_caso=id_juicio,
            detalles=detalles,
            fechas_ingreso=fechas_ingreso,
            detalles_proceso=detalles_proceso,
            payload_actuaciones=payload
        )


# --------------------------- Adaptador KPI judicial ---------------------------

def kpi_judicial_adapter(result: ScrapeResult) -> Dict[str, int]:
    """
    Map simplificado para tu motor:
      - procesosPenales: 1 si materia contiene 'PENAL' o hay 'delito' no vacío; 0 si no.
      - procesosLaborales: 1 si materia contiene 'LABORAL' o 'TRABAJO'; 0 si no.
    Ajusta esta lógica cuando tengas la taxonomía real de materias.
    """
    mat = (result.detalles.materia or "").upper()
    delito = (result.detalles.delito or "").strip()
    procesos_penales = 1 if ("PENAL" in mat or delito) else 0
    procesos_laborales = 1 if ("LABORAL" in mat or "TRABAJO" in mat) else 0
    return {
        "procesosPenales": procesos_penales,
        "procesosLaborales": procesos_laborales
    }


__all__ = [
    "EcuadorJudicialAPI",
    "ScrapeResult",
    "CausaDetalles",
    "kpi_judicial_adapter",
]
