# app/rutas/busqueda_usuario.py
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, AnyUrl
from typing import Optional, Dict, Any, List
import os
import requests
from dotenv import load_dotenv

load_dotenv()

router = APIRouter(prefix="/usuarios", tags=["usuarios"])

RAPIDAPI_HOST = "instagram-scraper21.p.rapidapi.com"
BASE_INFO_URL = "https://instagram-scraper21.p.rapidapi.com/api/v1/info"
BASE_SEARCH_URL = "https://instagram-scraper21.p.rapidapi.com/api/v1/search"


# =========================
# Modelos para /info (opcional, normalizado)
# =========================
class BioLink(BaseModel):
    image_url: Optional[AnyUrl] = None
    is_pinned: Optional[bool] = None
    link_type: Optional[str] = None
    lynx_url: Optional[AnyUrl] = None

class UserOut(BaseModel):
    username: str
    full_name: Optional[str] = None
    is_private: Optional[bool] = None
    is_verified: Optional[bool] = None
    profile_pic_url: Optional[AnyUrl] = None
    bio: Optional[str] = None
    bio_links: List[BioLink] = []
    raw: Optional[Dict[str, Any]] = None

class InfoResponse(BaseModel):
    status: str = "ok"
    data: Dict[str, Any]


# =========================
# Helpers
# =========================
def _get_api_key() -> str:
    api_key = os.getenv("API_KEY_RAPIDAPI")
    if not api_key:
        raise HTTPException(status_code=500, detail="Falta API_KEY_RAPIDAPI en el entorno")
    return api_key

def _do_request(url: str, params: Dict[str, Any]) -> Dict[str, Any]:
    headers = {
        "x-rapidapi-key": _get_api_key(),
        "x-rapidapi-host": RAPIDAPI_HOST,
    }
    try:
        r = requests.get(url, headers=headers, params=params, timeout=20)
    except requests.RequestException as e:
        raise HTTPException(status_code=502, detail=f"Error de red: {e}")

    if r.status_code == 404:
        raise HTTPException(status_code=404, detail="No encontrado")
    if r.status_code == 429:
        raise HTTPException(status_code=429, detail="Límite de tasa alcanzado en RapidAPI")
    if r.status_code >= 500:
        raise HTTPException(status_code=502, detail="Error del proveedor externo")
    if r.status_code != 200:
        try:
            detail = r.json()
        except Exception:
            detail = "Error del proveedor"
        raise HTTPException(status_code=r.status_code, detail=detail)

    payload = r.json()
    if payload.get("status") != "ok":
        # estructura inesperada o error lógico del proveedor
        raise HTTPException(status_code=400, detail=payload)
    return payload


# =========================
# /info - un usuario (normalizado)
# =========================
def _map_user_from_raw(u: Dict[str, Any]) -> UserOut:
    bio_links_raw = u.get("bio_links") or []
    bio_links: List[BioLink] = []
    for b in bio_links_raw:
        bio_links.append(
            BioLink(
                image_url=b.get("image_url") or None,
                is_pinned=b.get("is_pinned"),
                link_type=b.get("link_type"),
                lynx_url=b.get("lynx_url") or None,
            )
        )
    return UserOut(
        username=u.get("username") or "",
        full_name=u.get("full_name"),
        is_private=u.get("is_private"),
        is_verified=u.get("is_verified"),
        profile_pic_url=(u.get("profile_pic_url_hd") or u.get("profile_pic_url")) or None,
        bio=u.get("biography") or u.get("bio"),
        bio_links=bio_links,
        raw=u,
    )

@router.get("/info", response_model=InfoResponse)
def info_usuario(username: str = Query(..., min_length=2, description="Usuario de Instagram")):
    payload = _do_request(BASE_INFO_URL, {"id_or_username": username})
    user_raw = (payload.get("data") or {}).get("user")
    if not user_raw:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    user_out = _map_user_from_raw(user_raw)
    return InfoResponse(status="ok", data={"user": user_out.model_dump()})


# =========================
# /search - varios usuarios (RAW, lista de objetos completos)
# =========================
def _extract_users_from_search_payload(payload: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    El endpoint /api/v1/search puede venir en distintos formatos según el proveedor.
    Intentamos cubrir las variantes típicas:
      - payload["data"]["users"] -> [ {...}, {...} ]
      - payload["data"]["items"] -> [ {"user": {...}}, ... ]
      - payload["data"]["results"] -> [ {...}, ... ]
    Devuelve SIEMPRE una lista de objetos usuario (crudos).
    """
    data = payload.get("data") or {}
    users: List[Dict[str, Any]] = []

    if isinstance(data.get("users"), list) and data["users"]:
        # Caso A: lista directa de usuarios
        users = [u for u in data["users"] if isinstance(u, dict)]

    elif isinstance(data.get("items"), list) and data["items"]:
        # Caso B: lista de items que contienen "user"
        for item in data["items"]:
            if isinstance(item, dict):
                if isinstance(item.get("user"), dict):
                    users.append(item["user"])
                else:
                    # a veces el item ya es el user
                    users.append(item)

    elif isinstance(data.get("results"), list) and data["results"]:
        # Caso C: results directos
        users = [u for u in data["results"] if isinstance(u, dict)]

    # Filtra nulos y garantiza dict
    users = [u for u in users if isinstance(u, dict)]

    return users

@router.get("/search", response_model=List[Dict[str, Any]])
def buscar_usuarios(q: str = Query(..., min_length=2, description="Texto para buscar usuarios")):
    """
    Devuelve una LISTA con los objetos completos de cada usuario encontrado.
    Cada elemento de la lista es el JSON crudo del proveedor (sin normalizar).
    """
    payload = _do_request(BASE_SEARCH_URL, {"q": q})
    users = _extract_users_from_search_payload(payload)

    if not users:
        # Devolver lista vacía está OK, pero si prefieres error 404, descomenta:
        # raise HTTPException(status_code=404, detail="Sin usuarios para esa búsqueda")
        return []

    return users
