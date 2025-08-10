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

BALANCE_MARKERS = ["ESTADO DE SITUACION", "ESTADO DE SITUACIÓN", "BALANCE GENERAL", "1 ACTIVO", "2 PASIVO", "3 PATRIMONIO"]

# ---------- Utilidades ----------
def pdf_hash(pdf_bytes: bytes) -> str:
    return hashlib.sha256(pdf_bytes).hexdigest()

def extract_pages_text(pdf_bytes: bytes) -> List[Tuple[int, str]]:
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    out = []
    for i in range(doc.page_count):
        t = (doc.load_page(i).get_text("text") or "").strip()
        out.append((i + 1, t))
    return out

def looks_like_balance(full_text_upper: str) -> Tuple[bool, int]:
    hits = sum(1 for m in BALANCE_MARKERS if m in full_text_upper)
    return (hits >= 2, hits)

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

def build_vectorstore(chunks: List[Tuple[str, Dict[str, Any]]]) -> Chroma:
    # versión estable: en memoria (sin persistencia de disco)
    return Chroma.from_texts(
        texts=[c[0] for c in chunks],
        metadatas=[c[1] for c in chunks],
        embedding=embeddings,
        collection_name=COLLECTION_NAME,
    )

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

# ---------- Prompt / Chain ----------
SYSTEM_PROMPT = """Eres un analista contable. Objetivo:
1) Decidir si el documento es un ESTADO DE SITUACIÓN FINANCIERA (Balance, Ecuador SCVS).
2) Extraer montos numéricos de los campos solicitados.
3) Devolver SIEMPRE JSON ESTRICTO con el esquema provisto; sin texto adicional.

Reglas:
- No inventes valores; si no estás seguro, deja null y asigna confianza baja (p.ej. 0.3).
- Normaliza números al formato 1234.56 (punto decimal).
- Si faltan TOTALES pero hay 'corriente' y/o 'no corriente', calcula: total = (corriente || 0) + (no_corriente || 0).
- Reconoce variantes con o sin tildes (ACTIVO/PASIVO CORRIENTE, NO CORRIENTE, 1 ACTIVO, 2 PASIVO, 3 PATRIMONIO, etc.).
"""

USER_TEMPLATE = """Campos objetivo (keys del JSON):
- activos_corrientes, activos_no_corrientes, activos_totales
- pasivos_corrientes, pasivos_no_corrientes, pasivos_totales
- inventarios

Contexto por campo (fragmentos RAG):
{context}

Devuelve SOLO JSON con este schema:
{format_instructions}
"""

prompt = ChatPromptTemplate.from_messages([
    ("system", SYSTEM_PROMPT),
    ("human", USER_TEMPLATE),
])

def make_chain():
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
            "context": RunnablePassthrough(),  # recibimos el dict ya armado
            "format_instructions": lambda _: parser.get_format_instructions(),
        }
        | prompt
        | llm
        | parser  # <-- devuelve dict, NO objeto Pydantic
    )
    return chain, format_context

# ---------- Endpoint ----------
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

    full_upper = "\n".join([t.upper() for _, t in pages])
    seems_balance, hits = looks_like_balance(full_upper)

    # 2) Indexar (RAG) en memoria (estable)
    chunks = split_pages(pages, chunk_size=1600, chunk_overlap=150)
    chunks = [(txt, {**meta, "doc_hash": doc_id}) for (txt, meta) in chunks]
    vs = build_vectorstore(chunks)

    # 3) Retrieval por campo
    context_by_field = retrieve_context_by_field(vs, k=5)

    # 4) LLM + parser (devuelve dict)
    chain, _format_context = make_chain()
    result: Dict[str, Any] = chain.invoke({
        "context": context_by_field,
        "format_instructions": parser.get_format_instructions(),
    })

    # 5) Saneo + derivación totales
    fields = result.get("fields", {}) or {}
    fconf = result.get("field_confidence", {}) or {}

    def num(x): return sanitize_number(x)

    for k in list(fields.keys()):
        fields[k] = num(fields[k])

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

    evidence_pages = {k: v["pages"] for k, v in context_by_field.items()}

    # 6) KPIs (Balance-only)
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
        "capital_trabajo":   {"ratio": ct.ratio,   "score": ct.score},  # ratio aquí es monto (USD)
    }

    # 7) Guardar JSON en disco (cache simple por doc_hash)
    payload_to_save = {
        "doc_hash": doc_id,
        "is_balance": bool(result.get("is_balance")) if result.get("is_balance") is not None else seems_balance,
        "balance_confidence": float(result.get("balance_confidence") or (hits/4.0)),
        "fields": {k: (None if fields.get(k) is None else float(fields.get(k))) for k in TARGET_FIELDS},
        "field_confidence": {k: (None if fconf.get(k) is None else float(fconf.get(k))) for k in TARGET_FIELDS},
        "evidence_pages": evidence_pages,
        "kpis": kpis,
        "extraction_model": "LangChain(gpt-4o-mini) + Chroma(text-embedding-3-small)",
        "notes": [
            "Extracción LLM-first con RAG por campo (k=5).",
            "Se derivan totales cuando faltan corrientes/no corrientes.",
            "Si 'is_balance' es false, se debe pedir el Balance SCVS."
        ],
    }
    storage_dir = os.path.join(os.path.dirname(__file__), "..", "..", "storage")
    os.makedirs(storage_dir, exist_ok=True)
    save_path = os.path.abspath(os.path.join(storage_dir, f"{doc_id}.json"))
    with open(save_path, "w", encoding="utf-8") as f:
        json.dump(payload_to_save, f, ensure_ascii=False, indent=2)

    # 8) Respuesta
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
