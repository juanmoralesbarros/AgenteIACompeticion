# app/rutas/info_usuario.py
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, AnyUrl
from typing import Optional, List, Dict, Any
import os
import requests
from dotenv import load_dotenv

load_dotenv()

router = APIRouter(prefix="/usuarios", tags=["usuarios"])

RAPIDAPI_HOST = "instagram-scraper21.p.rapidapi.com"
BASE_INFO_URL = "https://instagram-scraper21.p.rapidapi.com/api/v1/info"


# Modelo de salida limpio
class BioLink(BaseModel):
    image_url: Optional[AnyUrl] = None
    is_pinned: Optional[bool] = None
    link_type: Optional[str] = None
    lynx_url: Optional[AnyUrl] = None

class UserClean(BaseModel):
    username: str
    full_name: Optional[str] = None
    is_private: Optional[bool] = None
    is_verified: Optional[bool] = None
    profile_pic_url: Optional[AnyUrl] = None
    bio: Optional[str] = None
    bio_links: List[BioLink] = []
    follower_count: Optional[int] = None
    following_count: Optional[int] = None
    media_count: Optional[int] = None
    category: Optional[str] = None


def _get_api_key() -> str:
    api_key = os.getenv("API_KEY_RAPIDAPI")
    if not api_key:
        raise HTTPException(status_code=500, detail="Falta API_KEY_RAPIDAPI en el entorno")
    return api_key


@router.get("/info-limpia", response_model=UserClean)
def info_usuario_limpia(id_or_username: str = Query(..., description="ID o username de Instagram")):
    headers = {
        "x-rapidapi-key": _get_api_key(),
        "x-rapidapi-host": RAPIDAPI_HOST
    }
    params = {"id_or_username": id_or_username}

    try:
        r = requests.get(BASE_INFO_URL, headers=headers, params=params, timeout=15)
    except requests.RequestException as e:
        raise HTTPException(status_code=502, detail=f"Error de red: {e}")

    if r.status_code != 200:
        raise HTTPException(status_code=r.status_code, detail=r.text)

    payload = r.json()
    if payload.get("status") != "ok":
        raise HTTPException(status_code=400, detail=payload)

    user = (payload.get("data") or {}).get("user")
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")

    # Mapeo de claves limpias
    bio_links_data = []
    for b in user.get("bio_links", []):
        bio_links_data.append(BioLink(
            image_url=b.get("image_url") or None,
            is_pinned=b.get("is_pinned"),
            link_type=b.get("link_type"),
            lynx_url=b.get("lynx_url") or None
        ))

    return UserClean(
        username=user.get("username", ""),
        full_name=user.get("full_name"),
        is_private=user.get("is_private"),
        is_verified=user.get("is_verified"),
        profile_pic_url=user.get("profile_pic_url_hd") or user.get("profile_pic_url"),
        bio=user.get("biography") or user.get("bio"),
        bio_links=bio_links_data,
        follower_count=user.get("follower_count"),
        following_count=user.get("following_count"),
        media_count=user.get("media_count"),
        category=user.get("category")
    )
