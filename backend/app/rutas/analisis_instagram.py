# app/rutas/analisis_instagram.py
from fastapi import APIRouter, HTTPException, Query, WebSocket, WebSocketDisconnect
from pydantic import BaseModel
from typing import Any, Dict, List, Optional, Tuple
import os
import requests

router = APIRouter(prefix="/analisis/instagram", tags=["análisis-instagram"])

RAPIDAPI_HOST = "instagram-scraper-20251.p.rapidapi.com"
BASE_USERPOSTS_URL = f"https://{RAPIDAPI_HOST}/userposts/"
BASE_POSTCOMMENTS_URL = f"https://{RAPIDAPI_HOST}/postcomments/"

def _get_api_key() -> str:
    key = os.getenv("API_KEY_RAPIDAPI")
    if not key:
        raise HTTPException(status_code=500, detail="Falta API_KEY_RAPIDAPI en el entorno")
    return key

def _do_req(url: str, params: Dict[str, Any]) -> Dict[str, Any]:
    headers = {
        "x-rapidapi-key": _get_api_key(),
        "x-rapidapi-host": RAPIDAPI_HOST,
    }
    try:
        r = requests.get(url, headers=headers, params=params, timeout=25)
    except requests.RequestException as e:
        raise HTTPException(status_code=502, detail=f"Error de red: {e}")
    if r.status_code != 200:
        raise HTTPException(status_code=r.status_code, detail=r.text)
    return r.json()

def _extract_post_codes(userposts_payload: Dict[str, Any]) -> List[Tuple[str, Dict[str, Any]]]:
    """
    Devuelve lista de (code, item_raw) robusta: intenta varias claves.
    """
    data = userposts_payload.get("data") or {}
    items: List[Dict[str, Any]] = data.get("items") or []
    out: List[Tuple[str, Dict[str, Any]]] = []

    for it in items:
        code = it.get("code") or it.get("shortcode") or None
        if not code:
            # algunos providers incluyen link con el code al final
            link = it.get("link") or it.get("url")
            if isinstance(link, str):
                # suele venir como https://www.instagram.com/p/<code>/
                parts = [p for p in link.split("/") if p]
                if parts:
                    code = parts[-1]
        if code:
            out.append((code, it))
    return out

class CommentOut(BaseModel):
    id: Optional[str] = None
    text: Optional[str] = None
    created_at: Optional[int] = None
    like_count: Optional[int] = None
    user_id: Optional[str] = None
    user_username: Optional[str] = None
    user_full_name: Optional[str] = None

class PostCommentsOut(BaseModel):
    code: str
    post_id: Optional[str] = None
    caption_text: Optional[str] = None
    comment_count: int
    comments: List[CommentOut]

class AnalysisResult(BaseModel):
    status: str
    username_or_id: str
    posts_checked: int
    requests_used: int
    comments_total: int
    items: List[PostCommentsOut]
    note: Optional[str] = None

@router.get("/comentarios", response_model=AnalysisResult)
def obtener_comentarios(
    username_or_id: str = Query(..., min_length=1, description="username o id"),
    max_posts: int = Query(10, ge=1, le=100, description="Máximo de posts a revisar"),
    max_requests_total: int = Query(50, ge=2, le=500, description="Presupuesto total de requests (incluye la de posts)"),
    max_comments_per_post: int = Query(200, ge=1, le=5000, description="Máximo de comentarios por post"),
    sort_by: str = Query("popular", pattern="^(popular|recent)$"),
):
    """
    Flujo:
    1) GET /userposts/ para username_or_id
    2) Extraer 'code' por post (hasta max_posts)
    3) Para cada code: GET /postcomments/?code_or_url=<code>&sort_by=&url_embed_safe=true
    4) Parar al agotar presupuesto de requests o al alcanzar límites.
    """
    print(f"[GET /comentarios] IN username_or_id={username_or_id} "
          f"max_posts={max_posts} max_requests_total={max_requests_total} "
          f"max_comments_per_post={max_comments_per_post} sort_by={sort_by}", flush=True)

    if max_requests_total < 2:
        raise HTTPException(status_code=400, detail="max_requests_total debe ser >= 2 (1 para posts + 1 para algún post)")

    requests_used = 0
    comments_total = 0
    results: List[PostCommentsOut] = []

    # 1) Posts
    print("[GET /comentarios] solicitando /userposts/", flush=True)
    posts_payload = _do_req(
        BASE_USERPOSTS_URL,
        {"username_or_id": username_or_id, "url_embed_safe": "true"},
    )
    requests_used += 1
    print(f"[GET /comentarios] posts_payload keys={list(posts_payload.keys())}", flush=True)

    post_pairs = _extract_post_codes(posts_payload)
    print(f"[GET /comentarios] post_codes encontrados={len(post_pairs)} "
          f"sample={[c for c,_ in post_pairs[:5]]}", flush=True)

    if not post_pairs:
        print("[GET /comentarios] sin post_pairs -> retorno vacío", flush=True)
        return AnalysisResult(
            status="ok",
            username_or_id=username_or_id,
            posts_checked=0,
            requests_used=requests_used,
            comments_total=0,
            items=[],
            note="Sin posts o sin código detectable.",
        )

    post_pairs = post_pairs[:max_posts]
    print(f"[GET /comentarios] iterando hasta {len(post_pairs)} posts", flush=True)

    # 2) Comentarios por post
    for code, raw in post_pairs:
        if requests_used >= max_requests_total:
            print(f"[GET /comentarios] presupuesto agotado (requests_used={requests_used}) -> break", flush=True)
            break

        print(f"[GET /comentarios] solicitando /postcomments/ code={code} "
              f"(req_used={requests_used}/{max_requests_total})", flush=True)
        payload = _do_req(
            BASE_POSTCOMMENTS_URL,
            {
                "code_or_url": code,
                "sort_by": sort_by,
                "url_embed_safe": "true",
            },
        )
        requests_used += 1
        print(f"[GET /comentarios] comments_payload keys={list(payload.keys())}", flush=True)

        data = payload.get("data") or {}
        items = data.get("items") or []
        print(f"[GET /comentarios] items_len={len(items)} (cap={max_comments_per_post})", flush=True)

        total_for_post = 0
        comments_out: List[CommentOut] = []

        for com in items[:max_comments_per_post]:
            user_obj = com.get("user") or {}
            comments_out.append(
                CommentOut(
                    id=str(com.get("id")) if com.get("id") is not None else None,
                    text=com.get("text"),
                    created_at=com.get("created_at") or com.get("created_at_utc"),
                    like_count=com.get("like_count"),
                    user_id=str(user_obj.get("id")) if user_obj.get("id") is not None else None,
                    user_username=user_obj.get("username"),
                    user_full_name=user_obj.get("full_name"),
                )
            )
            total_for_post += 1
        comments_total += total_for_post

        print(f"[GET /comentarios] code={code} recogidos={total_for_post} "
              f"(acumulado={comments_total})", flush=True)

        results.append(
            PostCommentsOut(
                code=code,
                post_id=str(raw.get("id")) if raw.get("id") is not None else None,
                caption_text=((raw.get("caption") or {}).get("text")) if isinstance(raw.get("caption"), dict) else None,
                comment_count=total_for_post,
                comments=comments_out,
            )
        )

        if requests_used >= max_requests_total:
            print(f"[GET /comentarios] presupuesto agotado tras code={code} "
                  f"(requests_used={requests_used})", flush=True)
            break

    status = "ok"
    note = None
    if requests_used >= max_requests_total:
        status = "partial"
        note = "Se alcanzó el límite de max_requests_total."

    print(f"[GET /comentarios] DONE status={status} posts_checked={len(results)} "
          f"requests_used={requests_used} comments_total={comments_total} note={note}", flush=True)

    return AnalysisResult(
        status=status,
        username_or_id=username_or_id,
        posts_checked=len(results),
        requests_used=requests_used,
        comments_total=comments_total,
        items=results,
        note=note,
    )

# =========================
# OPCIONAL: WebSocket de progreso
# =========================

@router.websocket("/ws/comentarios")
async def ws_comentarios(ws: WebSocket):
    """
    Conéctate y envía un JSON inicial con:
    {
      "username_or_id": "...",
      "max_posts": 10,
      "max_requests_total": 50,
      "max_comments_per_post": 200,
      "sort_by": "popular" | "recent"
    }
    Recibirás mensajes de progreso y, al final, un payload final
    con la misma forma que /comentarios.
    """
    print("[WS] conexión aceptada", flush=True)
    await ws.accept()
    try:
        params = await ws.receive_json()
        print(f"[WS] params={params}", flush=True)

        username_or_id = params.get("username_or_id")
        max_posts = int(params.get("max_posts", 10))
        max_requests_total = int(params.get("max_requests_total", 50))
        max_comments_per_post = int(params.get("max_comments_per_post", 200))
        sort_by = params.get("sort_by", "popular")
        print(f"[WS] START username_or_id={username_or_id} max_posts={max_posts} "
              f"max_requests_total={max_requests_total} max_comments_per_post={max_comments_per_post} "
              f"sort_by={sort_by}", flush=True)

        if not username_or_id:
            print("[WS] error: username_or_id requerido", flush=True)
            await ws.send_json({"type": "error", "message": "username_or_id requerido"})
            await ws.close()
            return

        # Estado
        requests_used = 0
        comments_total = 0
        results: List[PostCommentsOut] = []

        # Posts
        await ws.send_json({"type": "info", "message": "Solicitando posts…"})
        print("[WS] solicitando /userposts/", flush=True)
        posts_payload = _do_req(
            BASE_USERPOSTS_URL,
            {"username_or_id": username_or_id, "url_embed_safe": "true"},
        )
        requests_used += 1
        print(f"[WS] userposts payload keys={list(posts_payload.keys())}", flush=True)

        post_pairs = _extract_post_codes(posts_payload)[:max_posts]
        print(f"[WS] post_codes encontrados={len(post_pairs)} "
              f"sample={[c for c,_ in post_pairs[:5]]}", flush=True)
        await ws.send_json({"type": "progress", "step": "posts", "found": len(post_pairs)})

        for idx, (code, raw) in enumerate(post_pairs, start=1):
            if requests_used >= max_requests_total:
                print(f"[WS] presupuesto agotado antes de pedir comments (req_used={requests_used})", flush=True)
                break

            msg = f"Post {idx}/{len(post_pairs)} code={code}: comentarios…"
            await ws.send_json({"type": "info", "message": msg})
            print(f"[WS] {msg} (req_used={requests_used}/{max_requests_total})", flush=True)

            payload = _do_req(
                BASE_POSTCOMMENTS_URL,
                {
                    "code_or_url": code,
                    "sort_by": sort_by,
                    "url_embed_safe": "true",
                },
            )
            requests_used += 1

            data = payload.get("data") or {}
            items = data.get("items") or []
            print(f"[WS] code={code} items_len={len(items)} (cap={max_comments_per_post})", flush=True)

            total_for_post = 0
            comments_out: List[CommentOut] = []

            for com in items[:max_comments_per_post]:
                user_obj = com.get("user") or {}
                comments_out.append(
                    CommentOut(
                        id=str(com.get("id")) if com.get("id") is not None else None,
                        text=com.get("text"),
                        created_at=com.get("created_at") or com.get("created_at_utc"),
                        like_count=com.get("like_count"),
                        user_id=str(user_obj.get("id")) if user_obj.get("id") is not None else None,
                        user_username=user_obj.get("username"),
                        user_full_name=user_obj.get("full_name"),
                    )
                )
                total_for_post += 1

            comments_total += total_for_post
            results.append(
                PostCommentsOut(
                    code=code,
                    post_id=str(raw.get("id")) if raw.get("id") is not None else None,
                    caption_text=((raw.get("caption") or {}).get("text")) if isinstance(raw.get("caption"), dict) else None,
                    comment_count=total_for_post,
                    comments=comments_out,
                )
            )
            print(f"[WS] code={code} recogidos={total_for_post} (acumulado={comments_total})", flush=True)
            await ws.send_json({"type": "progress", "step": "comments", "post_index": idx, "comments": total_for_post})

            if requests_used >= max_requests_total:
                print(f"[WS] presupuesto agotado tras code={code} (req_used={requests_used})", flush=True)
                break

        status = "ok"
        note = None
        if requests_used >= max_requests_total:
            status = "partial"
            note = "Se alcanzó el límite de max_requests_total."

        print(f"[WS] DONE status={status} posts_checked={len(results)} "
              f"requests_used={requests_used} comments_total={comments_total}", flush=True)

        final = AnalysisResult(
            status=status,
            username_or_id=username_or_id,
            posts_checked=len(results),
            requests_used=requests_used,
            comments_total=comments_total,
            items=results,
            note=note,
        )
        await ws.send_json({"type": "done", "payload": final.model_dump()})
        await ws.close()

    except WebSocketDisconnect:
        print("[WS] cliente desconectado", flush=True)
        return
    except Exception as e:
        print(f"[WS] ERROR: {e}", flush=True)
        await ws.send_json({"type": "error", "message": str(e)})
        await ws.close()
