# app/rutas/info_usuario.py
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, AnyUrl
from typing import Optional, Dict, Any
import os
import requests
from dotenv import load_dotenv

load_dotenv()

router = APIRouter(prefix="/usuarios", tags=["usuarios"])

RAPIDAPI_HOST = "instagram-scraper-20251.p.rapidapi.com"
BASE_INFO_URL = f"https://{RAPIDAPI_HOST}/userinfo/"

class UserClean(BaseModel):
    id: str
    username: str
    full_name: Optional[str] = None
    is_verified: Optional[bool] = None
    profile_pic_url: Optional[AnyUrl] = None
    followers_count: Optional[int] = None
    following_count: Optional[int] = None
    media_count: Optional[int] = None
    # Extras útiles si están disponibles:
    is_private: Optional[bool] = None
    category: Optional[str] = None
    bio: Optional[str] = None

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
        try:
            detail = r.json()
        except Exception:
            detail = r.text
        raise HTTPException(status_code=r.status_code, detail=detail)
    return r.json()

def _normalize_info(p: Dict[str, Any]) -> UserClean:
    """
    La API de userinfo suele devolver algo como:
      { "data": { "id": "...", "username": "...", "full_name": "...", ... } }
    pero puede variar; mapeamos defensivamente.
    """
    data = p.get("data") or p  # algunos proveedores retornan plano en "data" o a nivel raíz
    # algunos devuelven nested: {"user": {...}}
    if isinstance(data.get("user"), dict):
        data = data["user"]

    uid = str(data.get("id") or data.get("pk") or data.get("user_id") or data.get("pk_id") or "")
    username = data.get("username") or ""
    full_name = data.get("full_name") or data.get("name")
    is_verified = data.get("is_verified")
    is_private = data.get("is_private")

    followers = (
        data.get("followers_count")
        or data.get("follower_count")
        or data.get("edge_followed_by", {}).get("count")
    )
    following = (
        data.get("following_count")
        or data.get("edge_follow", {}).get("count")
    )
    media = data.get("media_count") or data.get("posts_count")

    profile_pic_url = (
        data.get("profile_pic_url_hd")
        or data.get("profile_pic_url")
        or data.get("profile_picture")
        or None
    )
    bio = data.get("biography") or data.get("bio")
    category = data.get("category") or data.get("category_name")

    return UserClean(
        id=uid or username,  # fallback a username si id ausente
        username=username,
        full_name=full_name,
        is_verified=is_verified if is_verified is not None else None,
        profile_pic_url=profile_pic_url,
        followers_count=followers if isinstance(followers, int) else None,
        following_count=following if isinstance(following, int) else None,
        media_count=media if isinstance(media, int) else None,
        is_private=is_private if is_private is not None else None,
        category=category,
        bio=bio,
    )

@router.get("/info-limpia", response_model=UserClean)
def info_usuario_limpia(id_or_username: str = Query(..., description="ID o username de Instagram")):
    params = {
        "username_or_id": id_or_username,
        "include_about": "true",
        "url_embed_safe": "true",
    }
    payload = _do_request(BASE_INFO_URL, params)
    user = _normalize_info(payload)
    if not user.username:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    return user
