from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.rutas.busqueda_usuario import router as usuarios_router
from app.rutas.info_usuario import router as info_router

from app.rutas.kpis_llm import router as kpis_llm_router

from dotenv import load_dotenv
load_dotenv()
app = FastAPI(title="AgenteIA Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
def health():
    return {"status": "ok"}

app.include_router(usuarios_router, prefix="/api/v1")
app.include_router(info_router, prefix="/api/v1")

# SOLO la nueva LLM en el MVP:
app.include_router(kpis_llm_router, prefix="/api/v1")

