from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.rutas.busqueda_usuario import router as usuarios_router
from app.rutas.info_usuario import router as info_router
from app.rutas.legal import router as legal_router

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
app.include_router(legal_router)
