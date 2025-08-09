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

