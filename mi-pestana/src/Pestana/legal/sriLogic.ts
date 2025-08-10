// src/Pestana/legal/SriLogic.ts
import type { ComercialLegalPartial } from "../../hooks/useKpiScoringDemo";

export type SRIExistsOut = { ruc: string; exists: boolean };
export type SRIContribuyenteOut = {
  ruc: string;
  existe: boolean;
  data?: any | null;
};

function getBackendBase(): string {
  const vite = (typeof import.meta !== "undefined" && (import.meta as any).env?.VITE_API_BASE) as string | undefined;
  if (vite) return vite.replace(/\/$/, "");
  const cra =
    typeof window !== "undefined" &&
    (window as any).__REACT_APP_API_BASE as string | undefined;
  if (cra) return cra.replace(/\/$/, "");
  return ""; // mismo origen
}
const BACKEND = getBackendBase();
const API = `http://localhost:8000/api/v1/sri`;

export function looksLikeRuc(s: string) {
  return /^\d{13}$/.test(s.trim());
}

async function fetchJSON<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "include" });
  const ctype = res.headers.get("content-type") || "";
  const raw = await res.text();
  if (!ctype.includes("application/json")) {
    throw new Error(`Respuesta no-JSON desde ${url} (status ${res.status}). Primeros bytes: ${raw.slice(0, 120)}`);
  }
  const data = JSON.parse(raw);
  if (!res.ok) {
    const msg = (data && (data.detail || data.message)) || raw;
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${msg}`);
  }
  return data as T;
}

export async function sriExists(ruc: string) {
  const j = await fetchJSON<SRIExistsOut>(`${API}/exists?ruc=${encodeURIComponent(ruc)}`);
  return !!j.exists;
}
export async function sriContribuyente(ruc: string) {
  return await fetchJSON<SRIContribuyenteOut>(`${API}/contribuyente?ruc=${encodeURIComponent(ruc)}`);
}
export function toPartialFromSRI(out: SRIContribuyenteOut): ComercialLegalPartial {
  const d = out.data || {};
  const fechas = d.informacionFechasContribuyente || {};
  const fechaInicio =
    d.fechaInicioISO ||
    (fechas.fechaReinicioActividades || fechas.fechaInicioActividades); // usa reinicio si existe

  const toBool = (v: any) => {
    const s = String(v || "").trim().toUpperCase();
    if (s === "SI" || s === "SÍ" || s === "YES" || s === "TRUE") return true;
    if (s === "NO" || s === "FALSE") return false;
    return undefined;
  };

  return {
    procesosPenales: 0,
    procesosLaborales: 0,
    fechaInicioActividades: fechaInicio || undefined,
    estadoRuc: d.estadoContribuyenteRuc,
    fantasma: toBool(d.contribuyenteFantasma) ?? false,
    txInexistente: toBool(d.transaccionesInexistente) ?? false,
    obligadoContabilidad: typeof d.obligadoBool === "boolean" ? d.obligadoBool : toBool(d.obligadoLlevarContabilidad) ?? null,
    agenteRetencion: toBool(d.agenteRetencion) ?? null,
    contribuyenteEspecial: toBool(d.contribuyenteEspecial) ?? null,
    tipoContribuyente: d.tipoContribuyente,
    regimen: d.regimen,
  };
}

