const BASE_URL = process.env.REACT_APP_API_URL ?? "http://localhost:8000";

export async function getJSON<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { Accept: "application/json" },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${res.statusText} ${text}`);
  }
  return res.json() as Promise<T>;
}




/** Resultado de /api/v1/usuarios/search */
export type InstagramSearchItem = {
  username: string;
  full_name: string | null;
  is_verified: boolean;
  id: string;                     // puede venir como "id" o "pk" en tu backend; aquí usamos "id"
  profile_pic_url?: string | null;
  link?: string | null;
};

/** Resultado de /api/v1/usuarios/info-limpia */
export type InstagramInfo = {
  id: string;
  username: string;
  full_name?: string | null;
  is_verified?: boolean;
  profile_pic_url?: string | null;
  followers_count?: number;
  following_count?: number;
  media_count?: number;
};

export async function searchInstagramUsers(q: string) {
  const params = new URLSearchParams({ q });
  return getJSON<InstagramSearchItem[]>(`/api/v1/usuarios/search?${params}`);
}

export async function getInstagramInfo(idOrUsername: string) {
  const params = new URLSearchParams({ id_or_username: idOrUsername });
  return getJSON<InstagramInfo>(`/api/v1/usuarios/info-limpia?${params}`);
}




const KEY = "agenteia:selected_instagram";


export type SelectedInstagram = {
  platform: "instagram";
  id: string;
  username: string;
  fullName: string | null;
  profilePicUrl?: string | null;
  isVerified: boolean;
  followers?: number | null;
  following?: number | null;
  posts?: number | null;
};

export function saveSelectedInstagram(acc: SelectedInstagram) {
  localStorage.setItem(KEY, JSON.stringify(acc));
}

export function getSelectedInstagram(): SelectedInstagram | null {
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SelectedInstagram;
  } catch {
    return null;
  }
}

export function clearSelectedInstagram() {
  localStorage.removeItem(KEY);
}



// src/services/utilesPanel.ts  (añade al final del archivo)

//
// =============== WebSocket: análisis de comentarios IG ===============
//

// =============== WebSocket: análisis de comentarios IG ===============

/** Parámetros para la extracción */
export type StreamOptions = {
  usernameOrId: string;          // id o username (preferible id)
  maxPosts?: number;             // límite de posts a revisar
  maxRequests?: number;          // presupuesto total de requests (posts + comentarios)
  maxCommentsPerPost?: number;   // máximo comentarios por post
  sortBy?: "popular" | "recent"; // criterio del endpoint de comentarios
};

// === Tipos de mensajes del backend (discriminante: "type") ===
export type StreamStarted = {
  type: "started";
  meta: {
    username_or_id: string;
    max_posts: number;
    max_requests: number;
    max_comments_per_post: number;
    sort_by: "popular" | "recent";
  };
};

export type StreamProgress = {
  type: "progress";
  collected: number;        // total acumulado
  requestsUsed: number;     // requests usados
  lastPostCode?: string;
  lastBatchCount?: number;  // comentarios recibidos en el último batch
};

export type StreamPostDone = {
  type: "post_done";
  post: {
    id: string;
    code?: string | null;
    comments_count: number;
  };
};

// Comentario normalizado
export type WSComment = {
  post_code: string;
  post_id?: string;
  text: string;
  username: string;
  created_at?: string | number;
  like_count?: number;
};

export type StreamDone = {
  type: "done";
  summary: {
    postsVisited: number;
    requestsUsed: number;
    commentsTotal: number;
  };
  comments: WSComment[];   // lista completa de comentarios
};

export type StreamError = {
  type: "error";
  message: string;
};

export type StreamEvent =
  | StreamStarted
  | StreamProgress
  | StreamPostDone
  | StreamDone
  | StreamError;

/** Callbacks para consumir el stream en tu UI */
export type StreamHandlers = {
  onOpen?: () => void;
  onStarted?: (ev: StreamStarted) => void;
  onProgress?: (ev: StreamProgress) => void;
  onPostDone?: (ev: StreamPostDone) => void;
  onDone?: (ev: StreamDone) => void;
  onError?: (ev: StreamError) => void;
  onClose?: (ev: CloseEvent) => void;
};

// === Cálculo seguro del base WS (sin depender de BASE_URL global) ===
function getWsBase(): string {
  try {
    const u = new URL(BASE_URL);
    u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
    return u.origin;
  } catch {
    return BASE_URL.replace(/^https:/, "wss:").replace(/^http:/, "ws:");
  }
}

/**
 * Abre el WebSocket y gestiona los eventos.
 * Devuelve el socket y un helper para cerrar.
 */
export function connectInstagramCommentsStream(
  opts: StreamOptions,
  handlers: StreamHandlers = {}
) {
  const url = `${getWsBase()}/api/v1/analisis/instagram/ws/comentarios`;
  console.log("[WS] Conectando a:", url, opts);
  const ws = new WebSocket(url);

  ws.onopen = () => {
    console.log("[WS] Conexión abierta, enviando parámetros:", opts);
    handlers.onOpen?.();
    ws.send(JSON.stringify({
      username_or_id: opts.usernameOrId,
      max_posts: opts.maxPosts ?? 12,
      max_requests_total: opts.maxRequests ?? 30,
      max_comments_per_post: opts.maxCommentsPerPost ?? 100,
      sort_by: opts.sortBy ?? "popular",
    }));
  };

ws.onmessage = (e) => {
  try {
    const msg = JSON.parse(e.data);
    console.debug("[WS] Mensaje recibido:", msg);

    if (msg.type === "done") {
      // payload es AnalysisResult del backend -> lo normalizamos a tu StreamDone
      const p = msg.payload || {};
      const flatComments = (p.items ?? []).flatMap((it: any) => it?.comments ?? []);

      const normalized: StreamDone = {
        type: "done",
        summary: {
          postsVisited: Number(p.posts_checked ?? 0),
          requestsUsed: Number(p.requests_used ?? 0),
          commentsTotal: Number(p.comments_total ?? flatComments.length),
        },
        comments: flatComments,
      };

      console.debug("[WS] DONE normalizado:", normalized);
      handlers.onDone?.(normalized);
    } else if (msg.type === "error") {
      handlers.onError?.({ type: "error", error: msg.message || "stream_error" } as any);
    } else if (msg.type === "progress") {
      handlers.onProgress?.(msg as any);
    } else if (msg.type === "info") {
      // opcional
      console.debug("[WS] INFO:", msg);
    }
  } catch (err) {
    console.error("[WS] JSON parse error:", err, e.data);
    handlers.onError?.({ type: "error", error: "invalid_message_format" } as any);
  }
};


  ws.onerror = (err) => {
    console.error("[WS] Error en WebSocket:", err);
    handlers.onError?.({ type: "error", error: "socket_error" } as any);
  };

  ws.onclose = (ev) => {
    console.warn("[WS] Conexión cerrada:", ev);
    handlers.onClose?.(ev);
  };

  return {
    socket: ws,
    close: () => { try { ws.close(); } catch {} },
  };
}

export function streamCommentsAndCollect(
  opts: StreamOptions,
  progress?: Omit<StreamHandlers, "onDone" | "onClose" | "onError">
): Promise<StreamDone> {
  return new Promise<StreamDone>((resolve, reject) => {
    let settled = false;
    console.log("[WS] Iniciando streamCommentsAndCollect con opciones:", opts);

    const { close } = connectInstagramCommentsStream(opts, {
      ...progress,
      onError: (e) => {
        console.error("[WS] streamCommentsAndCollect -> onError", e);
        if (!settled) {
          settled = true;
          close();
          reject(new Error(e.message || "stream_error"));
        }
      },
      onDone: (d) => {
        console.log("[WS] streamCommentsAndCollect -> onDone", d);
        if (!settled) {
          settled = true;
          close();
          resolve(d);
        }
      },
      onClose: (ev) => {
        console.warn("[WS] streamCommentsAndCollect -> onClose", ev);
        if (!settled) {
          settled = true;
          reject(new Error("stream_closed"));
        }
      },
    });
  });
}

