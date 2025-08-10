# app/rutas/busqueda_usuario.py
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, AnyUrl
from typing import Optional, Dict, Any, List
import os
import requests
from dotenv import load_dotenv

load_dotenv()

router = APIRouter(prefix="/usuarios", tags=["usuarios"])

RAPIDAPI_HOST = "instagram-scraper-20251.p.rapidapi.com"
BASE_SEARCH_URL = f"https://{RAPIDAPI_HOST}/searchuser/"

# ==== Modelo normalizado para el front ====
class SearchUserOut(BaseModel):
    username: str
    full_name: Optional[str] = None
    is_verified: Optional[bool] = None
    id: str                                 # preferimos id (si no hay, pk, o username)
    profile_pic_url: Optional[AnyUrl] = None
    link: Optional[AnyUrl] = None

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

    if r.status_code == 429:
        raise HTTPException(status_code=429, detail="Límite de tasa alcanzado en RapidAPI")
    if r.status_code >= 500:
        raise HTTPException(status_code=502, detail="Error del proveedor externo")
    if r.status_code != 200:
        # Propaga detalle útil si existe
        try:
            detail = r.json()
        except Exception:
            detail = r.text
        raise HTTPException(status_code=r.status_code, detail=detail)
    return r.json()

def _extract_users(payload: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    La API puede retornar varias formas. Buscamos las listas típicas:
      - payload["items"]      -> lista de usuarios
      - payload["users"]      -> lista de usuarios
      - payload["results"]    -> lista de usuarios
      - payload["data"]       -> lista o dict con lista
    """
    candidates = []
    if isinstance(payload.get("items"), list):
        candidates = payload["items"]
    elif isinstance(payload.get("users"), list):
        candidates = payload["users"]
    elif isinstance(payload.get("results"), list):
        candidates = payload["results"]
    elif isinstance(payload.get("data"), list):
        candidates = payload["data"]
    elif isinstance(payload.get("data"), dict):
        d = payload["data"]
        for k in ("items", "users", "results"):
            if isinstance(d.get(k), list):
                candidates = d[k]
                break
    # Garantiza lista de dicts
    users = [u for u in (candidates or []) if isinstance(u, dict)]
    return users

def _normalize_user(u: Dict[str, Any]) -> SearchUserOut:
    username = u.get("username") or u.get("user", {}).get("username") or ""
    full_name = u.get("full_name") or u.get("user", {}).get("full_name")
    is_verified = u.get("is_verified") or u.get("user", {}).get("is_verified")
    # id preferido: id -> pk -> user.pk -> username
    uid = (
        str(u.get("id"))
        or str(u.get("pk"))
        or str(u.get("user", {}).get("pk") or "")
        or username
    )
    # foto y link
    profile_pic_url = (
        u.get("profile_pic_url")
        or u.get("profile_pic_url_hd")
        or u.get("user", {}).get("profile_pic_url")
        or u.get("user", {}).get("profile_pic_url_hd")
        or None
    )
    link = u.get("link") or (f"https://www.instagram.com/{username}" if username else None)

    return SearchUserOut(
        username=username,
        full_name=full_name,
        is_verified=bool(is_verified) if is_verified is not None else None,
        id=uid,
        profile_pic_url=profile_pic_url,
        link=link,
    )

@router.get("/search", response_model=List[SearchUserOut])
def buscar_usuarios(q: str = Query(..., min_length=2, description="Texto para buscar usuarios")):
    """
    Busca usuarios en Instagram (vía RapidAPI) y devuelve una LISTA NORMALIZADA:
    [{ username, full_name, is_verified, id, profile_pic_url, link }, ...]
    """
    payload = _do_request(BASE_SEARCH_URL, {"keyword": q})
    users = _extract_users(payload)
    if not users:
        return []
    return [_normalize_user(u) for u in users]
