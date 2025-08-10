# main.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.rutas.busqueda_usuario import router as usuarios_router
from app.rutas.info_usuario import router as info_router
from app.rutas.analisis_instagram import router as analisis_instagram_router
from app.rutas.kpis_llm import router as kpis_llm_router
from app.rutas.ws_server import router as ws_router
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(title="AgenteIA Backend")


DEV_ORIGINS = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:8080",
    "http://127.0.0.1:8080",
]

# CORS (dev)
app.add_middleware(
    CORSMiddleware,
    allow_origins=DEV_ORIGINS,
    # Si prefieres no listar: usa allow_origin_regex=".*" SOLO en dev
    # allow_origin_regex=".*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
def health():
    return {"status": "ok"}

# Rutas API v1
app.include_router(usuarios_router, prefix="/api/v1")
app.include_router(info_router, prefix="/api/v1")
app.include_router(analisis_instagram_router, prefix="/api/v1")
app.include_router(ws_router, prefix="/api/v1")
app.include_router(kpis_llm_router, prefix="/api/v1")
# Opcional: endpoint raíz
@app.get("/")
def root():
    return {"name": "AgenteIA Backend", "version": "v1"}

# Para ejecutar con: uvicorn main:app --reload

# SOLO la nueva LLM en el MVP:


# main.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.rutas.busqueda_usuario import router as usuarios_router
from app.rutas.info_usuario import router as info_router
from app.rutas.analisis_instagram import router as analisis_instagram_router

from app.rutas.kpis_llm import router as kpis_llm_router

from app.rutas.judicial_controller import router as judicial_router
from app.rutas.sri_controller import sri_router

from dotenv import load_dotenv
load_dotenv()

app = FastAPI(title="AgenteIA Backend")


DEV_ORIGINS = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:8080",
    "http://127.0.0.1:8080",
]

# CORS (dev)
app.add_middleware(
    CORSMiddleware,
    allow_origins=DEV_ORIGINS,
    # Si prefieres no listar: usa allow_origin_regex=".*" SOLO en dev
    # allow_origin_regex=".*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
def health():
    return {"status": "ok"}

# Rutas API v1
app.include_router(usuarios_router, prefix="/api/v1")
app.include_router(info_router, prefix="/api/v1")
app.include_router(analisis_instagram_router, prefix="/api/v1")

# Opcional: endpoint raíz
@app.get("/")
def root():
    return {"name": "AgenteIA Backend", "version": "v1"}

# Para ejecutar con: uvicorn main:app --reload

# SOLO la nueva LLM en el MVP:
app.include_router(kpis_llm_router, prefix="/api/v1")

app.include_router(judicial_router, prefix="/api/v1")
app.include_router(sri_router, prefix="/api/v1")