// src/Pestana/legal/LegalLogic.ts
// Cliente para /api/v1/judicial con adaptador a tu scoring.
// Helpers SMART: identidad y su par (cédula ⇄ ruc), dedupe; analizador de multas.

export type Rol = "demandado" | "actor";

const API_BASE =
  (import.meta as any)?.env?.VITE_API_URL?.replace(/\/+$/, "") ||
  "http://localhost:8000/api/v1";

async function postJSON<T>(path: string, body: unknown, init?: RequestInit): Promise<T> {
  const r = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    ...(init || {}),
  });
  const text = await r.text();
  const data = text ? JSON.parse(text) : null;
  if (!r.ok) {
    const msg = (data && (data.detail || data.message)) || `HTTP ${r.status}`;
    throw new Error(msg);
  }
  return data as T;
}

/* ===== Tipos backend (existentes) ===== */
export type CausaDetallesOut = {
  materia?: string | null;
  fecha?: string | null; // YYYY-MM-DD
  hora?: string | null;  // HH:MM
  tipoaccion?: string | null;
  delito?: string | null;
  judicatura?: string | null;
  actorofendido: string[];
  demandadoprocesado: string[];
  caso?: string | null; // idJuicio
};

export type ConsultaMaybeKpiResponse = {
  idCaso: string;
  general: CausaDetallesOut;
  fechaingreso: string[];     // DD-MM-YYYY
  detalleproceso: string[];
  payload: Record<string, any>;
  kpi?: { procesosPenales: number; procesosLaborales: number } | null;
};

export type CausaResumen = {
  idJuicio: string;
  numeroCausa?: string | null;
  nombreMateria?: string | null;
  nombreJudicatura?: string | null;
  fechaIngreso?: string | null; // ISO
  rol?: Rol;
  actorOfendido?: string[];
  demandadoProcesado?: string[];
  detalle?: CausaDetallesOut;
};

export type BuscarIdentidadResponse = {
  page: number;
  size: number;
  total: number;
  items: CausaResumen[];
};

/* ===== Tipos scoring (existentes) ===== */
export type ComercialLegalPartial = {
  procesosPenales?: number;
  procesosLaborales?: number;
};

/* ===== Nuevos tipos para nómina ===== */
export type RepresentanteNominaIn = {
  identificacion: string;
  tipo?: "RUC" | "CEDULA" | "PASAPORTE";
  nombre?: string;
  cargo?: string;
  tipoRepresentacion?: string; // RL, R, etc.
};

export type NominaRequest = {
  empresa_ruc: string;
  representantes: RepresentanteNominaIn[];
  incluir_kpi?: boolean; // default true
  roles?: Rol[]; // default ["demandado","actor"]
  page_size?: number; // default 50
  max_pages?: number; // default 3
};

export type IdentidadResumenOut = {
  identificacion: string;
  tipo?: string | null;
  nombre?: string | null;
  cargo?: string | null;
  tipoRepresentacion?: string | null;
  total_causas: number;
  por_rol: Record<string, number>;
  items: CausaResumen[];
  kpi?: { total: number; penal: number; laboral: number; transito: number; coactiva: number; contencioso: number } | null;
};

export type NominaResponse = {
  empresa: IdentidadResumenOut;
  representantes: IdentidadResumenOut[];
};

/* ===== Utilidades de identidad ===== */
export const looksLikeCedula = (s: string) => /^\d{10}$/.test((s || "").trim());
export const looksLikeRuc    = (s: string) => /^\d{13}$/.test((s || "").trim());
export const looksLikeIdentidad = (s: string) =>
  looksLikeCedula(s) || looksLikeRuc(s) || /^[A-Z0-9]{6,12}$/i.test((s || "").trim());

export const toRucFromCedula = (cedula: string) => looksLikeCedula(cedula) ? `${cedula.trim()}001` : cedula;
export const toCedulaFromRuc = (ruc: string) => looksLikeRuc(ruc) ? ruc.trim().slice(0, 10) : ruc;

function dedupeCausas(items: CausaResumen[]): CausaResumen[] {
  const seen = new Set<string>();
  const out: CausaResumen[] = [];
  for (const it of items) {
    const key = (it.idJuicio || it.numeroCausa || "").toString();
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}

/* ===== Llamadas (existentes) ===== */
export async function buscarPorIdentidad(
  identificacion: string,
  rol: Rol = "demandado",
  page = 1,
  size = 10
): Promise<BuscarIdentidadResponse> {
  return postJSON<BuscarIdentidadResponse>("/judicial/buscar-por-identidad", {
    identificacion,
    rol,
    page,
    size,
  });
}

export async function consultaConKpi(
  texto: string,
  rol: Rol = "demandado",
  incluir_kpi = true
): Promise<ConsultaMaybeKpiResponse> {
  return postJSON<ConsultaMaybeKpiResponse>("/judicial/consulta", {
    texto,
    rol,
    incluir_kpi,
  });
}

/* ===== Nueva llamada batch (existente) ===== */
export async function nominaResumen(req: NominaRequest): Promise<NominaResponse> {
  const body: NominaRequest = {
    incluir_kpi: true,
    roles: ["demandado", "actor"],
    page_size: 50,
    max_pages: 3,
    ...req,
  };
  return postJSON<NominaResponse>("/judicial/nomina-resumen", body);
}

/* ===== Adaptadores a tu scoring (existentes) ===== */
export function toComercialLegalPartial(resp: ConsultaMaybeKpiResponse): ComercialLegalPartial {
  if (resp.kpi) {
    return {
      procesosPenales: Number(resp.kpi.procesosPenales || 0),
      procesosLaborales: Number(resp.kpi.procesosLaborales || 0),
    };
  }
  // Fallback por si llamas sin incluir_kpi
  const mat = (resp.general?.materia || "").toUpperCase();
  const delito = (resp.general?.delito || "").trim();
  const procesosPenales = mat.includes("PENAL") || !!delito ? 1 : 0;
  const procesosLaborales = mat.includes("LABORAL") || mat.includes("TRABAJO") ? 1 : 0;
  return { procesosPenales, procesosLaborales };
}

export function kpiNominaToPartial(id: IdentidadResumenOut): ComercialLegalPartial {
  const k = id.kpi || ({} as any);
  // En tu scoring, la penalización es 30*penal + 15*laboral. Conviene pasar contadores, no binarios.
  return { procesosPenales: Number(k.penal || 0), procesosLaborales: Number(k.laboral || 0) };
}

export function aggregateNominaToPartial(resp: NominaResponse): ComercialLegalPartial {
  const all = [resp.empresa, ...(resp.representantes || [])];
  let pen = 0, lab = 0;
  for (const it of all) {
    const p = kpiNominaToPartial(it);
    pen = Math.max(pen, p.procesosPenales || 0);
    lab = Math.max(lab, p.procesosLaborales || 0);
  }
  return { procesosPenales: pen, procesosLaborales: lab };
}

/* =====================================================================
 * Helpers SMART: intentan identidad y su par (cédula ⇄ ruc)
 * ===================================================================== */

/** Busca por identidad y también por su "par" (si es cédula, prueba RUC=ced+001; si es RUC, prueba cédula=primeros 10). Deduplica. */
export async function buscarPorIdentidadSmart(
  identificacion: string,
  rol: Rol = "demandado",
  page = 1,
  size = 50
): Promise<BuscarIdentidadResponse> {
  const id = (identificacion || "").trim();
  const tries: string[] = [id];

  if (looksLikeCedula(id)) tries.push(toRucFromCedula(id));
  else if (looksLikeRuc(id)) tries.push(toCedulaFromRuc(id));

  const allItems: CausaResumen[] = [];
  let firstPage = page, firstSize = size;

  for (const t of tries) {
    try {
      const res = await buscarPorIdentidad(t, rol, page, size);
      if (res?.items?.length) allItems.push(...res.items);
      if (res && (res as any).page) { firstPage = (res as any).page; firstSize = (res as any).size; }
    } catch {
      // silencio
    }
  }
  const items = dedupeCausas(allItems);
  return { page: firstPage, size: firstSize, total: items.length, items };
}

/** Intenta consulta directa. Si falla o viene vacía y 'texto' parece identidad, prueba con su par (cédula ⇄ ruc). */
export async function consultaConKpiSmart(
  texto: string,
  rol: Rol = "demandado",
  incluir_kpi = true
): Promise<ConsultaMaybeKpiResponse> {
  const t = (texto || "").trim();
  try {
    const base = await consultaConKpi(t, rol, incluir_kpi);
    if (base && base.idCaso) return base;
  } catch { /* probamos alterno */ }

  let alt: string | null = null;
  if (looksLikeCedula(t)) alt = toRucFromCedula(t);
  else if (looksLikeRuc(t)) alt = toCedulaFromRuc(t);

  if (alt) {
    try {
      const altRes = await consultaConKpi(alt, rol, incluir_kpi);
      if (altRes && altRes.idCaso) return altRes;
    } catch { /* nos rendimos dignamente */ }
  }

  if (looksLikeIdentidad(t)) {
    const list = await buscarPorIdentidadSmart(t, rol, 1, 10);
    if (list.items.length) {
      const idj = list.items[0].idJuicio;
      return consultaConKpi(idj, rol, incluir_kpi);
    }
  }

  throw new Error("Sin resultados para la identificación o número proporcionado.");
}

/* ===== Nómina SMART: expande reps con identidad alterna y consulta ===== */

export function expandNominaInputs(req: NominaRequest): NominaRequest {
  const reps: RepresentanteNominaIn[] = [];
  const seen = new Set<string>();

  const pushOnce = (r: RepresentanteNominaIn) => {
    const key = (r.identificacion || "").trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    reps.push(r);
  };

  for (const r of (req.representantes || [])) {
    const id = (r.identificacion || "").trim();
    if (!id) continue;

    // original
    pushOnce({ ...r, identificacion: id });

    // alterno
    if (looksLikeCedula(id)) {
      pushOnce({ ...r, identificacion: toRucFromCedula(id), tipo: "RUC" });
    } else if (looksLikeRuc(id)) {
      pushOnce({ ...r, identificacion: toCedulaFromRuc(id), tipo: "CEDULA" });
    }
  }

  // empresa: si le pasan cédula por error, conviértelo a ruc alterno también
  let empresa_ruc = (req.empresa_ruc || "").trim();
  if (looksLikeCedula(empresa_ruc)) empresa_ruc = toRucFromCedula(empresa_ruc);

  return {
    ...req,
    empresa_ruc,
    representantes: reps,
  };
}

export async function nominaResumenSmart(req: NominaRequest): Promise<NominaResponse> {
  const expanded = expandNominaInputs(req);
  return nominaResumen(expanded);
}

/* =====================================================================
 * Analizador de multas/contravenciones
 * ===================================================================== */

export type MultaAnalisis = {
  isMultaLike: boolean;
  severity: "ninguna" | "leve" | "grave" | "gravísima" | "coactiva" | "contencioso" | "transito";
  amount?: number | null;
  hits: string[]; // pistas encontradas
};

/** Extrae y clasifica multas/contravenciones desde el detalle/payload. */
export function analizarMulta(det: ConsultaMaybeKpiResponse): MultaAnalisis {
  const mat = (det.general?.materia || "").toUpperCase();
  const tipo = (det.general?.tipoaccion || "").toUpperCase();
  const delito = (det.general?.delito || "").toUpperCase();

  const textos = [
    ...(det.detalleproceso || []),
    JSON.stringify(det.payload || {})
  ].join(" | ").toUpperCase();

  const isMultaBase =
    /MULTA|CONTRAVENC/.test(mat) ||
    /TR[ÁA]NSITO|TRANSITO/.test(mat) ||
    /COACTIV/.test(mat) ||
    /CONTENCIOSO\s*ADMINISTRATIVO/.test(mat) ||
    /MULTA|TR[ÁA]NSITO|CONTRAVENC/.test(tipo) ||
    /MULTA|CONTRAVENC|TR[ÁA]NSITO|COACTIV|CONTENCIOSO/.test(textos);

  if (!isMultaBase || delito) {
    // No tratamos como "multa" si viene 'delito' explícito: eso ya es penal.
    return { isMultaLike: false, severity: "ninguna", amount: null, hits: [] };
  }

  const hits: string[] = [];
  let severity: MultaAnalisis["severity"] = "transito";

  if (/GRAV[ÍI]SIMA/.test(textos)) { severity = "gravísima"; hits.push("gravísima"); }
  else if (/GRAVE(?!SIMA)/.test(textos)) { severity = "grave"; hits.push("grave"); }
  else if (/LEVE/.test(textos)) { severity = "leve"; hits.push("leve"); }

  if (/COACTIV/.test(mat) || /COACTIV/.test(textos)) { severity = "coactiva"; hits.push("coactiva"); }
  if (/CONTENCIOSO\s*ADMINISTRATIVO/.test(mat) || /CONTENCIOSO/.test(textos)) { severity = "contencioso"; hits.push("contencioso"); }

  // monto
  let amount: number | null = null;
  const m1 = textos.match(/\$\s*([0-9]{1,3}(?:[.,][0-9]{3})*(?:[.,][0-9]{2})?)/);
  if (m1) {
    const raw = m1[1].replace(/\./g, "").replace(",", ".");
    const val = Number(raw);
    if (isFinite(val)) amount = val;
    hits.push(`$${val}`);
  } else {
    const m2 = textos.match(/(VALOR|MONTO|MULTA)\s*[:=]\s*([0-9]+(?:[.,][0-9]{2})?)/);
    if (m2) {
      const val = Number(m2[2].replace(",", "."));
      if (isFinite(val)) amount = val;
      hits.push(`amt=${val}`);
    }
  }

  return { isMultaLike: true, severity, amount, hits };
}
