from fastapi import APIRouter, UploadFile, File, HTTPException
from pydantic import BaseModel, Field
from typing import Optional, Dict, Any, List, Tuple, NamedTuple
import os, re, json, hashlib
import fitz  # PyMuPDF

# LangChain & Chroma (versión estable)
from langchain_openai import ChatOpenAI, OpenAIEmbeddings
from langchain_community.vectorstores import Chroma
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import JsonOutputParser
from langchain_core.runnables import RunnablePassthrough

router = APIRouter(prefix="/kpis-llm", tags=["kpis-llm"])

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
if not OPENAI_API_KEY:
    raise RuntimeError("Falta OPENAI_API_KEY en backend/.env")

# LLM barato
llm = ChatOpenAI(model="gpt-4o-mini", temperature=0)
embeddings = OpenAIEmbeddings(model="text-embedding-3-small")

COLLECTION_NAME = "scvs_balance_chunks"

# ---------- KPIs (modelo & helpers) ----------
class KPIVal(NamedTuple):
    ratio: Optional[float]
    score: Optional[float]

def _safe_div(a, b):
    if a is None or b in (None, 0):
        return None
    return a / b

def _cap(x):
    return None if x is None else round(float(x), 6)

# Liquidez corriente = AC / PC
def kpi_liquidez(act_corr, pas_corr) -> KPIVal:
    r = _safe_div(act_corr, pas_corr)
    if r is None: return KPIVal(None, None)
    if r < 1.0: score = 10
    elif r <= 1.5: score = 50 + (r - 1.0) * (20 / 0.5)
    elif r <= 3.0: score = 70 + (r - 1.5) * (25 / 1.5)
    else: score = 90
    return KPIVal(_cap(r), round(score, 1))

# Endeudamiento = Pasivos Totales / Activos Totales
def kpi_endeudamiento(pas_tot, act_tot) -> KPIVal:
    r = _safe_div(pas_tot, act_tot)
    if r is None: return KPIVal(None, None)
    if r > 0.8: score = 10
    elif r > 0.6: score = 10 + (0.8 - r) * (20 / 0.2)
    elif r > 0.4: score = 30 + (0.6 - r) * (30 / 0.2)
    elif r > 0.2: score = 60 + (0.4 - r) * (25 / 0.2)
    else: score = 95
    return KPIVal(_cap(r), round(score, 1))

# Prueba ácida = (AC - Inventarios) / PC
def kpi_prueba_acida(act_corr, inventarios, pas_corr) -> KPIVal:
    if act_corr is None or pas_corr in (None, 0): return KPIVal(None, None)
    inv = inventarios or 0.0
    r = _safe_div(act_corr - inv, pas_corr)
    if r is None: return KPIVal(None, None)
    if r < 0.6: score = 15
    elif r <= 0.8: score = 40 + (r - 0.6) * (20 / 0.2)
    elif r <= 1.2: score = 60 + (r - 0.8) * (25 / 0.4)
    else: score = 90
    return KPIVal(_cap(r), round(score, 1))

# Solvencia = Activos Totales / Pasivos Totales
def kpi_solvencia(act_tot, pas_tot) -> KPIVal:
    r = _safe_div(act_tot, pas_tot)
    if r is None: return KPIVal(None, None)
    if r < 1.0: score = 10
    elif r <= 1.5: score = 45 + (r - 1.0) * (20 / 0.5)
    elif r <= 2.5: score = 65 + (r - 1.5) * (25 / 1.0)
    else: score = 92
    return KPIVal(_cap(r), round(score, 1))

# Apalancamiento = Pasivos Totales / Patrimonio (Patrimonio = Activos - Pasivos)
def kpi_apalancamiento(pas_tot, act_tot) -> KPIVal:
    if pas_tot is None or act_tot in (None, 0): return KPIVal(None, None)
    pat = act_tot - pas_tot
    if pat in (None, 0): return KPIVal(None, None)
    r = _safe_div(pas_tot, pat)
    if r is None: return KPIVal(None, None)
    if r > 2.0: score = 10
    elif r > 1.0: score = 30 + (2.0 - r) * (30 / 1.0)
    elif r > 0.5: score = 60 + (1.0 - r) * (25 / 0.5)
    else: score = 92
    return KPIVal(_cap(r), round(score, 1))

# Capital de trabajo = AC - PC (monto)
def kpi_capital_trabajo(act_corr, pas_corr) -> KPIVal:
    if act_corr is None or pas_corr is None: return KPIVal(None, None)
    r = act_corr - pas_corr
    score = 90 if r > 0 else 30
    return KPIVal(_cap(r), float(score))

# ---------- Modelo de respuesta (extracción + KPIs + guardado) ----------
class ExtractedBalanceResponse(BaseModel):
    is_balance: bool
    balance_confidence: float
    fields: Dict[str, Optional[float]]
    field_confidence: Dict[str, Optional[float]]
    evidence_pages: Dict[str, List[int]]
    extraction_model: str
    doc_hash: str
    notes: List[str]
    kpis: Dict[str, Dict[str, Optional[float]]] = {}
    saved_path: Optional[str] = None

# ---------- Esquema esperado del LLM ----------
class BalanceFields(BaseModel):
    is_balance: bool = Field(..., description="¿Es Estado de Situación Financiera?")
    balance_confidence: float = Field(..., ge=0, le=1)
    fields: Dict[str, Optional[float]] = Field(..., description="activos_corrientes,..., pasivos_totales, inventarios")
    field_confidence: Dict[str, Optional[float]] = Field(..., description="confianza 0..1 por campo")

parser = JsonOutputParser(pydantic_object=BalanceFields)

TARGET_FIELDS = [
    "activos_corrientes",
    "activos_no_corrientes",
    "activos_totales",
    "pasivos_corrientes",
    "pasivos_no_corrientes",
    "pasivos_totales",
    "inventarios",
]

QUERY_HINTS = {
    "activos_corrientes": ["ACTIVO CORRIENTE", "ACTIVOS CORRIENTES"],
    "activos_no_corrientes": ["ACTIVO NO CORRIENTE", "ACTIVOS NO CORRIENTES"],
    "activos_totales": ["1 ACTIVO", "TOTAL ACTIVO", "TOTAL ACTIVOS"],
    "pasivos_corrientes": ["PASIVO CORRIENTE", "PASIVOS CORRIENTES"],
    "pasivos_no_corrientes": ["PASIVO NO CORRIENTE", "PASIVOS NO CORRIENTES"],
    "pasivos_totales": ["2 PASIVO", "TOTAL PASIVO", "TOTAL PASIVOS", "PASIVO (TOTAL)"],
    "inventarios": ["INVENTARIO", "INVENTARIOS", "EXISTENCIAS"],
}

# ---------- ERI ----------
class ERIFields(BaseModel):
    is_eri: bool = Field(..., description="¿Es Estado de Resultado Integral?")
    eri_confidence: float = Field(..., ge=0, le=1)
    fields: Dict[str, Optional[float]] = Field(..., description="ventas, costo_ventas, utilidad_neta, inventario_inicial?, inventario_final?")
    field_confidence: Dict[str, Optional[float]] = Field(..., description="confianza 0..1 por campo")

parser_eri = JsonOutputParser(pydantic_object=ERIFields)

TARGET_FIELDS_ERI = ["ventas", "costo_ventas", "utilidad_neta"]

QUERY_HINTS_ERI = {
    "ventas": ["40101 VENTA DE BIENES", "INGRESOS DE ACTIVIDADES ORDINARIAS", "VENTAS"],
    "costo_ventas": ["501 COSTO DE VENTAS", "COSTO DE VENTAS Y PRODUCCIÓN"],
    "utilidad_neta": ["707 GANANCIA (PÉRDIDA) NETA DEL PERIODO", "UTILIDAD NETA", "RESULTADO NETO"],
    "inventario_inicial": ["INVENTARIO INICIAL", "EXISTENCIAS INICIALES"],
    "inventario_final": ["INVENTARIO FINAL", "EXISTENCIAS FINALES"],
}

SYSTEM_PROMPT_ERI = """Eres un analista contable.
1) Decide si el documento es ESTADO DE RESULTADO INTEGRAL (SCVS).
2) Extrae: ventas, costo_ventas, utilidad_neta y si existen inventario_inicial/final.
3) Devuelve SOLO JSON estricto con el esquema.
Reglas:
- No inventes: si no estás seguro, null y confianza baja.
- Normaliza números al formato 1234.56.
- Reconoce variantes y códigos (401..., 501..., 707...)."""

USER_TEMPLATE_ERI = """Campos objetivo (usa SOLO cada bloque):

[ventas]
{ventas}

[costo_ventas]
{costo_ventas}

[utilidad_neta]
{utilidad_neta}

[inventario_inicial]
{inventario_inicial}

[inventario_final]
{inventario_final}

Devuelve SOLO JSON con este schema:
{format_instructions}
"""


prompt_eri = ChatPromptTemplate.from_messages([
    ("system", SYSTEM_PROMPT_ERI),
    ("human", USER_TEMPLATE_ERI),
])


def make_chain_eri():
    def to_inputs(ctx_dict: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
        def ctx(k: str) -> str:
            return (ctx_dict.get(k, {}) or {}).get("context") or ""
        return {
            "ventas":              ctx("ventas"),
            "costo_ventas":        ctx("costo_ventas"),
            "utilidad_neta":       ctx("utilidad_neta"),
            "inventario_inicial":  ctx("inventario_inicial"),
            "inventario_final":    ctx("inventario_final"),
            "format_instructions": parser_eri.get_format_instructions(),
        }
    chain = prompt_eri | llm | parser_eri
    return chain, to_inputs


# ---------- EFE ----------
class CashFlowFields(BaseModel):
    is_cashflow: bool = Field(..., description="¿Es Estado de Flujo de Efectivo (SCVS)?")
    cashflow_confidence: float = Field(..., ge=0, le=1)
    fields: Dict[str, Optional[float]] = Field(..., description="flujo_operacion, neto_efectivo, efectivo_inicio, efectivo_final, intereses_pagados, intereses_recibidos, impuestos_pagados")
    field_confidence: Dict[str, Optional[float]] = Field(..., description="confianza 0..1 por campo")

parser_efe = JsonOutputParser(pydantic_object=CashFlowFields)

TARGET_FIELDS_EFE = ["flujo_operacion", "neto_efectivo", "efectivo_inicio", "efectivo_final"]

QUERY_HINTS_EFE = {
    "flujo_operacion": ["9501", "FLUJOS DE EFECTIVO", "ACTIVIDADES DE OPERACIÓN", "OPERACION"],
    "neto_efectivo": ["9505", "INCREMENTO (DISMINUCIÓN) NETO DE EFECTIVO"],
    "efectivo_inicio": ["9506", "EFECTIVO Y EQUIVALENTES AL EFECTIVO AL PRINCIPIO DEL PERIODO"],
    "efectivo_final": ["9507", "EFECTIVO Y EQUIVALENTES AL EFECTIVO AL FINAL DEL PERIODO"],
    "intereses_pagados": ["INTERESES PAGADOS"],
    "intereses_recibidos": ["INTERESES RECIBIDOS"],
    "impuestos_pagados": ["IMPUESTOS A LAS GANANCIAS PAGADOS", "IMPUESTOS PAGADOS"],
}

SYSTEM_PROMPT_EFE = """Eres un analista contable.
1) Decide si el documento es ESTADO DE FLUJO DE EFECTIVO (SCVS).
2) Extrae: flujo_operacion (mínimo), y si existen neto_efectivo, efectivo_inicio/final, intereses/impuestos.
3) Devuelve SOLO JSON estricto con el esquema.
Reglas:
- No inventes: si no estás seguro, null y confianza baja.
- Normaliza 1234.56.
- Reconoce variantes y códigos 9501..9507."""

USER_TEMPLATE_EFE = """Campos objetivo:
- flujo_operacion, neto_efectivo, efectivo_inicio, efectivo_final, intereses_pagados, intereses_recibidos, impuestos_pagados

Contexto por campo:
{context}

Devuelve SOLO JSON con este schema:
{format_instructions}
"""

prompt_efe = ChatPromptTemplate.from_messages([
    ("system", SYSTEM_PROMPT_EFE),
    ("human", USER_TEMPLATE_EFE),
])

def make_chain_efe():
    def format_context(ctx_dict: Dict[str, Dict[str, Any]]) -> str:
        parts = []
        for k, v in ctx_dict.items():
            pages = v.get("pages") or []
            ctx = v.get("context") or ""
            if ctx:
                parts.append(f"### {k} (páginas {pages})\n{ctx}")
        return "\n\n".join(parts)
    chain = (
        {
            "context": RunnablePassthrough(),
            "format_instructions": lambda _: parser_efe.get_format_instructions(),
        }
        | prompt_efe
        | llm
        | parser_efe
    )
    return chain, format_context

# ---------- Utilidades de análisis / RAG (flexibles) ----------

BALANCE_MARKERS = [
    "ESTADO DE SITUACION FINANCIERA",
    "ESTADO DE SITUACIÓN FINANCIERA",
    "ESTADO DE SITUACION",
    "ESTADO DE SITUACIÓN",
    "BALANCE GENERAL",
    "BALANCE DE SITUACION",
    "1 ACTIVO", "2 PASIVO", "3 PATRIMONIO",
    "TOTAL ACTIVO", "TOTAL PASIVO",
]

ERI_MARKERS = [
    "ESTADO DE RESULTADO INTEGRAL",
    "ESTADO DE RESULTADOS",
    "RESULTADO DEL PERIODO",
    "INGRESOS DE ACTIVIDADES ORDINARIAS",
    "VENTAS", "INGRESOS",
    "COSTO DE VENTAS",
    "UTILIDAD NETA", "RESULTADO NETO",
    "401", "501", "707",
]

EFE_MARKERS = [
    "ESTADO DE FLUJO DE EFECTIVO",
    "FLUJOS DE EFECTIVO",
    "FLUJO DE EFECTIVO",
    "ACTIVIDADES DE OPERACIÓN", "OPERACION",
    "ACTIVIDADES DE INVERSION", "ACTIVIDADES DE FINANCIACION",
    "9501", "9505", "9506", "9507",
]

# ---------- Utilidades básicas ----------

def pdf_hash(pdf_bytes: bytes) -> str:
    import hashlib
    return hashlib.sha256(pdf_bytes).hexdigest()

def extract_pages_text(pdf_bytes: bytes) -> List[Tuple[int, str]]:
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    out: List[Tuple[int, str]] = []
    for i in range(doc.page_count):
        t = (doc.load_page(i).get_text("text") or "").strip()
        out.append((i + 1, t))
    return out

def looks_like(full_text_upper: str, markers: List[str], min_hits: int = 1) -> Tuple[bool, int]:
    """
    Heurística TOLERANTE: con 1 match basta para 'parece'.
    Úsalo para setear *_confidence o defaults, NO para bloquear.
    """
    hits = sum(1 for m in markers if m in full_text_upper)
    return (hits >= min_hits, hits)

def looks_like_balance(full_text_upper: str) -> Tuple[bool, int]:
    # min_hits=1 (flexible como la versión que te funcionaba)
    return looks_like(full_text_upper, BALANCE_MARKERS, min_hits=1)

def looks_like_eri(full_text_upper: str) -> Tuple[bool, int]:
    return looks_like(full_text_upper, ERI_MARKERS, min_hits=1)

def looks_like_efe(full_text_upper: str) -> Tuple[bool, int]:
    return looks_like(full_text_upper, EFE_MARKERS, min_hits=1)


def sanitize_number(x) -> Optional[float]:
    if x is None:
        return None
    if isinstance(x, (int, float)):
        return float(x)
    s = str(x).strip().replace(" ", "")
    s = s.replace(".", "").replace(",", ".")  # 1.234,56 -> 1234.56
    m = re.search(r"-?\d+(\.\d+)?", s)
    return float(m.group()) if m else None

def split_pages(pages: List[Tuple[int, str]], chunk_size=1600, chunk_overlap=150):
    splitter = RecursiveCharacterTextSplitter(chunk_size=chunk_size, chunk_overlap=chunk_overlap)
    out: List[Tuple[str, Dict[str, Any]]] = []
    for pno, text in pages:
        if not text:
            continue
        parts = splitter.split_text(text)
        for part in parts:
            out.append((part, {"page": pno}))
    return out

def retrieve_context_by_field(vs: Chroma, k: int = 5) -> Dict[str, Dict[str, Any]]:
    retriever = vs.as_retriever(search_kwargs={"k": k})
    out = {}
    for f, hints in QUERY_HINTS.items():
        query = " | ".join(hints)
        docs = retriever.invoke(query)
        pages = sorted(list({d.metadata.get("page") for d in docs if d and d.metadata.get("page")}))  # type: ignore
        context = "\n\n".join([d.page_content for d in docs])  # type: ignore
        out[f] = {"context": context, "pages": pages}
    return out

# ---------- Header / escala / sanitizer robusto ----------
HEADER_PATTERNS = {
    "ruc": r"\bRUC[:\s]*([0-9\-]+)",
    "empresa": r"(RAZ[ÓO]N SOCIAL|DENOMINACI[ÓO]N)[:\s]*([A-Z0-9\.\-&\s]+)",
    "anio": r"\b(20\d{2})\b",
    "moneda": r"(USD|D[ÓO]LARES|\$)",
    "escala": r"\b(en\s+mil(es)?|miles)\b",
}

def parse_header_meta(text: str) -> Dict[str, Any]:
    u = (text or "").upper()
    meta: Dict[str, Any] = {}
    for k, pat in HEADER_PATTERNS.items():
        m = re.search(pat, u)
        if m:
            meta[k] = (m.group(1) if k != "empresa" else m.group(2)).strip()
    meta["scale_factor"] = 1000.0 if "escala" in meta else 1.0
    return meta

def sanitize_number_robust(x) -> Optional[float]:
    if x is None:
        return None
    if isinstance(x, (int, float)):
        return float(x)
    s = str(x)
    s = s.replace("\u2212","-").replace("–","-").replace("—","-")  # guiones largos
    neg = False
    if "(" in s and ")" in s:
        neg = True
        s = s.replace("(", "").replace(")", "")
    s = s.strip().replace(" ", "")
    s = s.replace(".", "").replace(",", ".")  # 1.234,56 -> 1234.56
    m = re.search(r"-?\d+(\.\d+)?", s)
    if not m:
        return None
    val = float(m.group())
    return -abs(val) if neg and val >= 0 else val

def retrieve_context_generic(vs: Chroma, hints_map: Dict[str, List[str]], k: int = 5) -> Dict[str, Dict[str, Any]]:
    retriever = vs.as_retriever(search_kwargs={"k": k})
    out: Dict[str, Dict[str, Any]] = {}
    for f, hints in hints_map.items():
        query = " | ".join(hints)
        docs = retriever.invoke(query)
        pages = sorted(list({d.metadata.get("page") for d in docs if d and d.metadata.get("page")}))  # type: ignore
        context = "\n\n".join([d.page_content for d in docs])  # type: ignore
        out[f] = {"context": context, "pages": pages}
    return out

CODE_VALUE_PAT = re.compile(
    r"(?P<code>\b\d{4,6}\b)[^\-+\d]{0,40}(?P<val>[\(\)\-\d\.\,]+)", re.IGNORECASE
)

def _norm_num(s: str) -> Optional[float]:
    # Igual que sanitize_number_robust pero mínima
    if s is None: return None
    s = str(s)
    neg = False
    if "(" in s and ")" in s:
        neg = True
        s = s.replace("(", "").replace(")", "")
    s = s.replace("\u2212","-").replace("–","-").replace("—","-")
    s = s.strip().replace(" ", "").replace(".", "").replace(",", ".")
    m = re.search(r"-?\d+(\.\d+)?", s)
    if not m: return None
    val = float(m.group())
    return -abs(val) if neg and val >= 0 else val

def extract_codes_from_pages(pages: List[Tuple[int, str]]) -> Dict[str, Dict[str, Any]]:
    """
    Devuelve un índice {code: {'value': float, 'pages': [..], 'raw': '...'}} 
    tomando SIEMPRE la última aparición del código (por si hay totales repetidos).
    """
    out: Dict[str, Dict[str, Any]] = {}
    for pno, text in pages:
        for line in text.splitlines():
            m = CODE_VALUE_PAT.search(line)
            if not m:
                continue
            code = m.group("code")
            val = _norm_num(m.group("val"))
            if val is None:
                continue
            out[code] = {"value": val, "pages": sorted(list(set((out.get(code) or {}).get("pages", []) + [pno]))), "raw": line}
    return out

def pick(values_by_code: Dict[str, Dict[str, Any]], code: str) -> tuple[Optional[float], list[int]]:
    d = values_by_code.get(code)
    return (None, []) if not d else (float(d["value"]), d["pages"])

# ---------- Prompt / Chain (BALANCE, contexto por campo) ----------

SYSTEM_PROMPT = """Eres un analista contable. Objetivo:
1) Decidir si el documento es un ESTADO DE SITUACIÓN FINANCIERA (Balance, Ecuador SCVS).
2) Extraer montos numéricos SOLO de los campos solicitados.
3) Devolver SIEMPRE JSON ESTRICTO con el esquema provisto; sin texto adicional.

Reglas:
- Usa ÚNICAMENTE el contexto provisto para CADA campo; no mezcles contextos entre campos.
- No inventes valores; si no estás seguro, deja null y confianza baja (p.ej. 0.3).
- Normaliza números al formato 1234.56 (punto decimal).
- Si faltan TOTALES pero hay 'corriente' y/o 'no corriente', calcula: total = (corriente || 0) + (no_corriente || 0).
- Para 'inventarios' toma el rubro de BALANCE (no uses líneas de ERI ni EFE).
- Reconoce variantes con o sin tildes (ACTIVO/PASIVO CORRIENTE, NO CORRIENTE, 1 ACTIVO, 2 PASIVO, 3 PATRIMONIO, TOTAL ACTIVO/PASIVO)."""

USER_TEMPLATE = """Extrae los siguientes campos. Para cada campo, usa SOLO su bloque de contexto.

[activos_corrientes]
{activos_corrientes}

[activos_no_corrientes]
{activos_no_corrientes}

[activos_totales]
{activos_totales}

[pasivos_corrientes]
{pasivos_corrientes}

[pasivos_no_corrientes]
{pasivos_no_corrientes}

[pasivos_totales]
{pasivos_totales}

[inventarios]
{inventarios}

Devuelve SOLO JSON con este schema:
{format_instructions}
"""

prompt = ChatPromptTemplate.from_messages([
    ("system", SYSTEM_PROMPT),
    ("human", USER_TEMPLATE),
])

def make_chain():
    def to_inputs(ctx_dict: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
        def ctx(k: str) -> str:
            return (ctx_dict.get(k, {}) or {}).get("context") or ""
        return {
            "activos_corrientes":     ctx("activos_corrientes"),
            "activos_no_corrientes":  ctx("activos_no_corrientes"),
            "activos_totales":        ctx("activos_totales"),
            "pasivos_corrientes":     ctx("pasivos_corrientes"),
            "pasivos_no_corrientes":  ctx("pasivos_no_corrientes"),
            "pasivos_totales":        ctx("pasivos_totales"),
            "inventarios":            ctx("inventarios"),
            "format_instructions":    parser.get_format_instructions(),
        }

    chain = prompt | llm | parser
    return chain, to_inputs


# ---------- Prompt / Chain (ERI, contexto por campo y códigos) ----------

SYSTEM_PROMPT_ERI = """Eres un analista contable.
Objetivo:
1) Decidir si el documento es ESTADO DE RESULTADO INTEGRAL (SCVS).
2) Extraer SOLO: ventas, costo_ventas, utilidad_neta y, si existen, inventario_inicial e inventario_final.
3) Devuelve SOLO JSON ESTRICTO con el esquema provisto; sin texto adicional.

Reglas:
- Usa ÚNICAMENTE el contexto del campo correspondiente.
- Prioriza líneas con CÓDIGOS SCVS:
  • ventas => códigos 401xx o el total con rótulos 'VENTAS' / 'INGRESOS DE ACTIVIDADES ORDINARIAS'.
  • costo_ventas => código 501 (total) o rótulo 'COSTO DE VENTAS' / 'COSTO DE VENTAS Y PRODUCCIÓN'.
  • utilidad_neta => código 707 'GANANCIA (PÉRDIDA) NETA DEL PERIODO'. Mantén el signo (negativo si pérdida).
- Inventarios (opcional, para cálculo de inventario promedio):
  • Busca rótulos 'INVENTARIO INICIAL' y 'INVENTARIO FINAL' dentro del bloque de costo de ventas.
  • Excluye variantes de 'MATERIA PRIMA' y 'PRODUCTOS EN PROCESO' (solo mercaderías/bienes para la venta).
  • Si la presentación muestra signo por convención (p. ej., inventario final negativo), DEVUELVE el valor en ABSOLUTO.
- Normaliza números al formato 1234.56.
- Si no hay evidencia clara en el contexto de un campo, deja null con confianza baja (p.ej., 0.3)."""

USER_TEMPLATE_ERI = """Campos objetivo (usa SOLO cada bloque):

[ventas]
{ventas}

[costo_ventas]
{costo_ventas}

[utilidad_neta]
{utilidad_neta}

[inventario_inicial]
{inventario_inicial}

[inventario_final]
{inventario_final}

Devuelve SOLO JSON con este schema:
{format_instructions}
"""

def make_chain_eri():
    def to_inputs(ctx_dict: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
        def ctx(k: str) -> str:
            return (ctx_dict.get(k, {}) or {}).get("context") or ""
        return {
            "ventas":              ctx("ventas"),
            "costo_ventas":        ctx("costo_ventas"),
            "utilidad_neta":       ctx("utilidad_neta"),
            "inventario_inicial":  ctx("inventario_inicial"),
            "inventario_final":    ctx("inventario_final"),
            "format_instructions": parser_eri.get_format_instructions(),
        }
    chain = prompt_eri | llm | parser_eri
    return chain, to_inputs

# ---------- Prompt / Chain (EFE, contexto por campo y códigos exactos) ----------

SYSTEM_PROMPT_EFE = """Eres un analista contable.
Objetivo:
1) Decidir si el documento es ESTADO DE FLUJO DE EFECTIVO (SCVS).
2) Extraer SOLO:
   - flujo_operacion (TOTAL de operación) => código EXACTO 9501 (4 dígitos), no uses 950101.. ni subtotales.
   - neto_efectivo (incremento/disminución neto) => código EXACTO 9505.
   - efectivo_inicio => código EXACTO 9506.
   - efectivo_final  => código EXACTO 9507.
   - intereses_pagados => código EXACTO 950105 (si aparece).
   - intereses_recibidos => código EXACTO 950106 (si aparece).
   - impuestos_pagados => código EXACTO 950107 (si aparece).
3) Devuelve SOLO JSON ESTRICTO con el esquema provisto; sin texto adicional.

Reglas:
- Usa ÚNICAMENTE el contexto del campo correspondiente.
- Para los totales, elige la línea cuyo código coincide EXACTAMENTE (4 dígitos para 9501/9505/9506/9507 y 6 dígitos para 950105/950106/950107).
- No confundas otros pagos (p. ej., 95010205) con 9501.
- Normaliza números al formato 1234.56.
- Si el campo no está de forma explícita, deja null con confianza baja (p.ej., 0.3)."""

USER_TEMPLATE_EFE = """Campos objetivo (usa SOLO cada bloque):

[flujo_operacion]
{flujo_operacion}

[neto_efectivo]
{neto_efectivo}

[efectivo_inicio]
{efectivo_inicio}

[efectivo_final]
{efectivo_final}

[intereses_pagados]
{intereses_pagados}

[intereses_recibidos]
{intereses_recibidos}

[impuestos_pagados]
{impuestos_pagados}

Devuelve SOLO JSON con este schema:
{format_instructions}
"""

prompt_efe = ChatPromptTemplate.from_messages([
    ("system", SYSTEM_PROMPT_EFE),
    ("human", USER_TEMPLATE_EFE),
])

def make_chain_efe():
    def to_inputs(ctx_dict: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
        def ctx(k: str) -> str:
            return (ctx_dict.get(k, {}) or {}).get("context") or ""
        return {
            "flujo_operacion":     ctx("flujo_operacion"),
            "neto_efectivo":       ctx("neto_efectivo"),
            "efectivo_inicio":     ctx("efectivo_inicio"),
            "efectivo_final":      ctx("efectivo_final"),
            "intereses_pagados":   ctx("intereses_pagados"),
            "intereses_recibidos": ctx("intereses_recibidos"),
            "impuestos_pagados":   ctx("impuestos_pagados"),
            "format_instructions": parser_efe.get_format_instructions(),
        }
    chain = prompt_efe | llm | parser_efe
    return chain, to_inputs


def build_vectorstore(chunks: List[Tuple[str, Dict[str, Any]]]) -> Chroma:
    """
    Crea un vectorstore en memoria con un nombre de colección único por documento,
    usando los metadatos de los chunks (doc_hash) que agregaste arriba.
    """
    if not chunks:
        # Evita fallas raras si llega una lista vacía
        return Chroma.from_texts(
            texts=[""],
            metadatas=[{"doc_hash": "empty"}],
            embedding=embeddings,
            collection_name=f"{COLLECTION_NAME}_empty",
        )

    texts = [c[0] for c in chunks]
    metas = [c[1] for c in chunks]

    # Tomamos el doc_hash del primer chunk (todos comparten el mismo)
    doc_hash = metas[0].get("doc_hash", "nohash")
    coll_name = f"{COLLECTION_NAME}_{doc_hash[:8]}"

    return Chroma.from_texts(
        texts=texts,
        metadatas=metas,
        embedding=embeddings,
        collection_name=coll_name,
    )

# ---------- Endpoint: BALANCE (flexible, contexto por campo, escala opcional) ----------
@router.post("/from-pdf", response_model=ExtractedBalanceResponse)
async def extract_from_pdf(file: UploadFile = File(...)):
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="El archivo debe ser PDF.")

    pdf_bytes = await file.read()
    doc_id = pdf_hash(pdf_bytes)

    # 1) Texto por páginas
    pages = extract_pages_text(pdf_bytes)
    if not pages:
        raise HTTPException(status_code=422, detail="No se pudo extraer texto del PDF (¿escaneado sin OCR?).")

    # Meta de encabezado y escala
    header_meta = parse_header_meta(pages[0][1] if pages else "")
    scale = float(header_meta.get("scale_factor", 1.0) or 1.0)

    full_upper = "\n".join([t.upper() for _, t in pages])
    seems_balance, hits = looks_like_balance(full_upper)  # NO bloquea; solo influye en defaults

    # 2) Indexar (RAG) por documento
    chunks = split_pages(pages, chunk_size=1600, chunk_overlap=150)
    chunks = [(txt, {**meta, "doc_hash": doc_id}) for (txt, meta) in chunks]
    vs = build_vectorstore(chunks)

    # 3) Retrieval por campo
    context_by_field = retrieve_context_by_field(vs, k=5)

    # 4) LLM con contexto por campo (prompt específico)
    chain, to_inputs = make_chain()
    result: Dict[str, Any] = chain.invoke(to_inputs(context_by_field))

    # 5) Saneo + derivación de totales + aplicar escala
    fields = (result.get("fields") or {})  # lo que devuelva el LLM
    fconf = (result.get("field_confidence") or {})

    for k in list(fields.keys()):
        fields[k] = sanitize_number_robust(fields[k])

    if fields.get("activos_totales") is None:
        ac, anc = fields.get("activos_corrientes"), fields.get("activos_no_corrientes")
        if ac is not None or anc is not None:
            fields["activos_totales"] = (ac or 0.0) + (anc or 0.0)
            fconf["activos_totales"] = min((fconf.get("activos_corrientes") or 0.6),
                                           (fconf.get("activos_no_corrientes") or 0.6))

    if fields.get("pasivos_totales") is None:
        pc, pnc = fields.get("pasivos_corrientes"), fields.get("pasivos_no_corrientes")
        if pc is not None or pnc is not None:
            fields["pasivos_totales"] = (pc or 0.0) + (pnc or 0.0)
            fconf["pasivos_totales"] = min((fconf.get("pasivos_corrientes") or 0.6),
                                           (fconf.get("pasivos_no_corrientes") or 0.6))

    for k in list(fields.keys()):
        fields[k] = None if fields[k] is None else fields[k] * scale

    evidence_pages = {k: (context_by_field.get(k, {}) or {}).get("pages", []) for k in QUERY_HINTS.keys()}

    # 6) KPIs
    liq  = kpi_liquidez(fields.get("activos_corrientes"), fields.get("pasivos_corrientes"))
    acid = kpi_prueba_acida(fields.get("activos_corrientes"), fields.get("inventarios"), fields.get("pasivos_corrientes"))
    end  = kpi_endeudamiento(fields.get("pasivos_totales"), fields.get("activos_totales"))
    solv = kpi_solvencia(fields.get("activos_totales"), fields.get("pasivos_totales"))
    apal = kpi_apalancamiento(fields.get("pasivos_totales"), fields.get("activos_totales"))
    ct   = kpi_capital_trabajo(fields.get("activos_corrientes"), fields.get("pasivos_corrientes"))

    kpis = {
        "liquidez_corriente": {"ratio": liq.ratio,  "score": liq.score},
        "prueba_acida":      {"ratio": acid.ratio, "score": acid.score},
        "endeudamiento":     {"ratio": end.ratio,  "score": end.score},
        "solvencia":         {"ratio": solv.ratio, "score": solv.score},
        "apalancamiento":    {"ratio": apal.ratio, "score": apal.score},
        "capital_trabajo":   {"ratio": ct.ratio,   "score": ct.score},
    }

    # 7) Guardado
    payload_to_save = {
        "doc_hash": doc_id,
        "is_balance": bool(result.get("is_balance")) if result.get("is_balance") is not None else seems_balance,
        "balance_confidence": float(result.get("balance_confidence") or (hits / 4.0)),
        "fields": {k: (None if fields.get(k) is None else float(fields.get(k))) for k in TARGET_FIELDS},
        "field_confidence": {k: (None if fconf.get(k) is None else float(fconf.get(k))) for k in TARGET_FIELDS},
        "evidence_pages": evidence_pages,
        "kpis": kpis,
        "extraction_model": "LangChain(gpt-4o-mini) + Chroma(text-embedding-3-small)",
        "header_meta": header_meta,
        "data_quality": {
            "non_null_ratio": None,
            "balance_markers_hits": hits,
            "scale_factor": scale,
        },
        "notes": [
            "Extracción con contexto por campo (prompt específico).",
            "Totales derivados si faltan corrientes/no corrientes.",
        ],
    }
    non_null_ratio = sum(v is not None for v in payload_to_save["fields"].values()) / len(payload_to_save["fields"])
    payload_to_save["data_quality"]["non_null_ratio"] = non_null_ratio

    storage_dir = os.path.join(os.path.dirname(__file__), "..", "..", "storage")
    os.makedirs(storage_dir, exist_ok=True)
    save_path = os.path.abspath(os.path.join(storage_dir, f"{doc_id}.json"))
    with open(save_path, "w", encoding="utf-8") as f:
        json.dump(payload_to_save, f, ensure_ascii=False, indent=2)

    return ExtractedBalanceResponse(
        is_balance=payload_to_save["is_balance"],
        balance_confidence=payload_to_save["balance_confidence"],
        fields=payload_to_save["fields"],
        field_confidence=payload_to_save["field_confidence"],
        evidence_pages=payload_to_save["evidence_pages"],
        extraction_model=payload_to_save["extraction_model"],
        doc_hash=doc_id,
        notes=payload_to_save["notes"],
        kpis=kpis,
        saved_path=save_path
    )


# ---------- Endpoint: ERI (contexto por campo, limitado a 3 campos) ----------
@router.post("/eri/from-pdf")
async def extract_eri_from_pdf(file: UploadFile = File(...)):
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="El archivo debe ser PDF.")
    pdf_bytes = await file.read()
    doc_id = pdf_hash(pdf_bytes)

    pages = extract_pages_text(pdf_bytes)
    if not pages:
        raise HTTPException(status_code=422, detail="No se pudo extraer texto (¿escaneado sin OCR?).")

    full_upper = "\n".join([t.upper() for _, t in pages])
    seems_eri, hits_eri = looks_like_eri(full_upper)  # NO bloquea

    # Header meta y escala
    header_meta = parse_header_meta(pages[0][1] if pages else "")
    scale = float(header_meta.get("scale_factor", 1.0) or 1.0)

    # RAG
    chunks = split_pages(pages, chunk_size=1600, chunk_overlap=150)
    chunks = [(txt, {**meta, "doc_hash": doc_id}) for (txt, meta) in chunks]
    vs = build_vectorstore(chunks)
    context_by_field = retrieve_context_generic(vs, QUERY_HINTS_ERI, k=5)

    # LLM
    chain, to_inputs = make_chain_eri()
    try:
        result: Dict[str, Any] = chain.invoke(to_inputs(context_by_field))
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"ERI: fallo al parsear JSON estricto del LLM: {e}")

    # Fields
    fields = (result.get("fields") or {})
    fconf  = (result.get("field_confidence") or {})
    for k in list(fields.keys()):
        fields[k] = sanitize_number_robust(fields[k])
        fields[k] = None if fields[k] is None else fields[k] * scale

    evidence_pages = {k: (context_by_field.get(k, {}) or {}).get("pages", []) for k in QUERY_HINTS_ERI.keys()}

    payload = {
        "doc_hash": doc_id,
        "is_eri": bool(result.get("is_eri")) if result.get("is_eri") is not None else seems_eri,
        "eri_confidence": float(result.get("eri_confidence") or (hits_eri / 4.0)),
        # SOLO guardamos los 3 campos acordados:
        "fields": {k: (None if fields.get(k) is None else float(fields.get(k))) for k in TARGET_FIELDS_ERI},
        "field_confidence": {k: (None if fconf.get(k) is None else float(fconf.get(k))) for k in TARGET_FIELDS_ERI},
        "evidence_pages": evidence_pages,
        "extraction_model": "LangChain(gpt-4o-mini) + Chroma(text-embedding-3-small)",
        "header_meta": header_meta,
        "data_quality": {
            "eri_markers_hits": hits_eri,
            "scale_factor": scale,
        },
        "notes": ["ERI con contexto por campo. Campos limitados a ventas, costo_ventas, utilidad_neta."],
    }

    storage_dir = os.path.join(os.path.dirname(__file__), "..", "..", "storage")
    os.makedirs(storage_dir, exist_ok=True)
    save_path = os.path.abspath(os.path.join(storage_dir, f"{doc_id}_eri.json"))
    with open(save_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    return {"doc_hash": doc_id, "saved_path": save_path, **payload}


# ---------- Endpoint: EFE (códigos exactos 9501/9505/9506/9507 + fallback LLM; guardamos 5 campos) ----------
@router.post("/efe/from-pdf")
async def extract_efe_from_pdf(file: UploadFile = File(...)):
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="El archivo debe ser PDF.")
    pdf_bytes = await file.read()
    doc_id = pdf_hash(pdf_bytes)

    pages = extract_pages_text(pdf_bytes)
    if not pages:
        raise HTTPException(status_code=422, detail="No se pudo extraer texto (¿escaneado sin OCR?).")

    full_upper = "\n".join([t.upper() for _, t in pages])
    seems_efe, hits_efe = looks_like_efe(full_upper)  # heurística, no bloquea

    header_meta = parse_header_meta(pages[0][1] if pages else "")
    scale = float(header_meta.get("scale_factor", 1.0) or 1.0)

    # 1) Extracción por CÓDIGO exacto
    code_idx = extract_codes_from_pages(pages)
    fields_code: Dict[str, Optional[float]] = {}
    fconf: Dict[str, Optional[float]] = {}
    evidence_pages: Dict[str, List[int]] = {}

    # Solo 4 campos (mantener alcance)
    code_map = {
        "9501": "flujo_operacion",
        "9505": "neto_efectivo",
        "9506": "efectivo_inicio",
        "9507": "efectivo_final",
    }

    for code, fname in code_map.items():
        val, pgs = pick(code_idx, code)
        if val is not None:
            fields_code[fname] = val
            fconf[fname] = 0.95
            evidence_pages[fname] = pgs

    # 2) Fallback LLM SOLO si falta algún total clave
    main_fields = ["flujo_operacion", "neto_efectivo", "efectivo_inicio", "efectivo_final"]
    missing = [k for k in main_fields if fields_code.get(k) is None]

    if missing:
        chunks = split_pages(pages, chunk_size=1600, chunk_overlap=150)
        chunks = [(txt, {**meta, "doc_hash": doc_id}) for (txt, meta) in chunks]
        vs = build_vectorstore(chunks)
        context_by_field = retrieve_context_generic(vs, QUERY_HINTS_EFE, k=5)

        chain, to_inputs = make_chain_efe()
        result: Dict[str, Any] = chain.invoke(to_inputs(context_by_field))
        fields_llm = (result.get("fields") or {})
        fconf_llm = (result.get("field_confidence") or {})

        for k in missing:
            v = sanitize_number_robust(fields_llm.get(k))
            if v is not None:
                fields_code[k] = v
                fconf[k] = float(fconf_llm.get(k) or 0.6)
                evidence_pages[k] = (context_by_field.get(k, {}) or {}).get("pages", [])

    # 3) Escala
    for k in list(fields_code.keys()):
        fields_code[k] = None if fields_code[k] is None else fields_code[k] * scale

    # 4) Señal de tipo + confianza
    found = sum(1 for k in main_fields if fields_code.get(k) is not None)
    is_cashflow = bool(seems_efe or found >= 2)  # si hay 2+ totales o markers, lo consideramos EFE
    cashflow_confidence = 0.25 * found  # 0..1 según # de totales encontrados

    payload = {
        "doc_hash": doc_id,
        "is_cashflow": is_cashflow,
        "cashflow_confidence": cashflow_confidence if found > 0 else (hits_efe / 4.0),
        "fields": {k: (None if fields_code.get(k) is None else float(fields_code.get(k))) for k in main_fields},
        "field_confidence": {k: (None if fconf.get(k) is None else float(fconf.get(k))) for k in main_fields},
        "evidence_pages": {k: evidence_pages.get(k, []) for k in main_fields},
        "extraction_model": "Códigos exactos 95xx (+ fallback LLM gpt-4o-mini) + Chroma(text-embedding-3-small)",
        "header_meta": header_meta,
        "data_quality": {
            "efe_markers_hits": hits_efe,
            "scale_factor": scale
        },
        "notes": [
            "Preferencia por códigos exactos 9501/9505/9506/9507.",
            "Fallback LLM por campo solo si el código no aparece."
        ],
    }

    storage_dir = os.path.join(os.path.dirname(__file__), "..", "..", "storage")
    os.makedirs(storage_dir, exist_ok=True)
    save_path = os.path.abspath(os.path.join(storage_dir, f"{doc_id}_efe.json"))
    with open(save_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    return {"doc_hash": doc_id, "saved_path": save_path, **payload}
