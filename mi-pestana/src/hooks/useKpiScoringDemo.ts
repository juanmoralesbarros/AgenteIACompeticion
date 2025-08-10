import { useMemo, useState } from "react";

/* =====================================
 * Tipos base
 * ===================================== */
export type Dossier = {
  ruc: string;
  financiera: {
    activosCorrientes: number;
    pasivosCorrientes: number;
    pasivosTotales: number;
    activosTotales: number;
    utilidadNeta: number; // anual
    ventas: number; // anual
    costoVentas: number; // anual
    inventarioPromedio: number;
    flujoCajaOperativo: number; // mensual o anual según options.periodoFinanciero
  };
  digital: { estrellas: number; reseñas: number; fans: number; sentimiento: number };
  comercialLegal: {
    ivaPorPagarMensual: number[]; // ideal 12
    procesosPenales: number;
    procesosLaborales: number;
    fechaInicioActividades?: string ; // ISO
    // Los siguientes pueden llegar vía merge desde el parcial
    estadoRuc?: string;
    fantasma?: boolean;
    txInexistente?: boolean;
    obligadoContabilidad?: boolean | null;
    agenteRetencion?: boolean | null;
    contribuyenteEspecial?: boolean | null;
    tipoContribuyente?: string;
    regimen?: string;
    fechaCeseActividades?: string; // ISO
    fechaReinicioActividades?: string; // ISO
  };
  decision: {
    ingresosMensuales: number;
    egresosMensuales: number;
    cuotasVigentes: number;
    tasaMensual: number;
    nMeses: number;
    pmtPropuesta?: number;
  };
};

/* =====================================
 * Parcial legal que se inyecta desde el front
 * ===================================== */
export type ComercialLegalPartial = {
  procesosPenales: number;
  procesosLaborales: number;
  ivaPorPagarMensual?: number[];
  fechaInicioActividades?: string;
  fechaCeseActividades?: string;
  fechaReinicioActividades?: string;
  estadoRuc?: "ACTIVO" | "SUSPENDIDO" | "BAJA" | string;
  fantasma?: boolean;
  txInexistente?: boolean;
  obligadoContabilidad?: boolean | null;
  agenteRetencion?: boolean | null;
  contribuyenteEspecial?: boolean | null;
  tipoContribuyente?: string;
  regimen?: string; // "GENERAL" | "RIMPE" | ...
};

export type KPI = {
  key: string;
  label: string;
  raw: number; // puede ser NaN si missing
  unidad: string;
  score: number; // 0..100
  fuente: string;
  hint: string;
  categoria: "Financieros" | "Digitales" | "Comercial/Legal";
  missing?: boolean;
};

/* =====================================
 * Opciones del motor (dinámicas)
 * ===================================== */

type PeriodoFinanciero = "mensual" | "anual";
export type ScoringOptions = {
  periodoFinanciero?: PeriodoFinanciero; // cómo viene CFO (default: "anual")
  pesos?: { Financieros: number; Digitales: number; "Comercial/Legal": number };
  umbrales?: { aprobado: number; condicionado: number; revision: number };
  requires?: { coverageMin: number; dsrMax: number; dscrMin: number };
  limitesMonto?: { kVentas: number; mCFO: number };
  params?: {
    margen_k?: number; margen_x0?: number;
    rotinv_k?: number; rotinv_x0?: number;
    cfoMargin_k?: number; cfoMargin_x0?: number;
    iva_cv_good?: number; iva_cv_bad?: number; // CV bajo es mejor
  };
  calibracion?: { a: number; b: number }; // PD = 1/(1+exp(-(a+b*score)))
};

const DEFAULT_OPTS: Required<ScoringOptions> = {
  periodoFinanciero: "anual",
  pesos: { Financieros: 0.7, Digitales: 0.1, "Comercial/Legal": 0.2 },
  umbrales: { aprobado: 80, condicionado: 65, revision: 50 },
  requires: { coverageMin: 0.7, dsrMax: 0.35, dscrMin: 1.2 },
  limitesMonto: { kVentas: 0.25, mCFO: 8 },
  params: {
    margen_k: 60, margen_x0: 0.06,
    rotinv_k: 0.7, rotinv_x0: 6,
    cfoMargin_k: 50, cfoMargin_x0: 0.05,
    iva_cv_good: 0.05, iva_cv_bad: 0.30,
  },
  calibracion: { a: -5.0, b: 0.06 },
};

/* =====================================
 * Mock base (para demo y pruebas)
 * ===================================== */
export const MOCK_DOSSIER: Dossier = {
  ruc: "1790012345001",
  financiera: {
    activosCorrientes: 120000,
    pasivosCorrientes: 60000,
    pasivosTotales: 180000,
    activosTotales: 350000,
    utilidadNeta: 32000,
    ventas: 280000,
    costoVentas: 170000,
    inventarioPromedio: 40000,
    flujoCajaOperativo: 21000, // por defecto se interpreta como ANUAL (ver options)
  },
  digital: { estrellas: 4.3, reseñas: 156, fans: 2450, sentimiento: 0.35 },
  comercialLegal: {
    ivaPorPagarMensual: [1200, 1150, 1180, 1210, 1190, 1205, 1202, 1198, 1201, 1203, 1204, 1206],
    procesosPenales: 0,
    procesosLaborales: 1,
    fechaInicioActividades: "2016-05-10",
  },
  decision: {
    ingresosMensuales: 42000,
    egresosMensuales: 28000,
    cuotasVigentes: 3500,
    tasaMensual: 0.025,
    nMeses: 24,
    pmtPropuesta: 1200,
  },
};

/* =====================================
 * Helpers numéricos
 * ===================================== */
const clamp = (x: number, min = 0, max = 100) => Math.max(min, Math.min(max, x));
const mapLinear = (x: number, xmin: number, xmax: number) => {
  if (!isFinite(x)) return 0;
  if (x <= xmin) return 0;
  if (x >= xmax) return 100;
  return ((x - xmin) / (xmax - xmin)) * 100;
};
const mapLinearInv = (x: number, xmin: number, xmax: number) => 100 - mapLinear(x, xmin, xmax);
const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const sd = (a: number[]) => {
  if (!a.length) return 0;
  const m = avg(a);
  return Math.sqrt(avg(a.map((x) => (x - m) ** 2)));
};
const yearsSince = (iso: string) => (Date.now() - new Date(iso).getTime()) / (365.25 * 24 * 3600 * 1000);
const monthsSince = (iso: string) => (Date.now() - new Date(iso).getTime()) / (30.4375 * 24 * 3600 * 1000);
const logistic01 = (x: number, k: number, x0: number) => 1 / (1 + Math.exp(-k * (x - x0)));
const annualize = (val: number, periodo: PeriodoFinanciero) => (periodo === "mensual" ? val * 12 : val);

/* =====================================
 * Derivados de capacidad
 * ===================================== */
function calcularDerivados(d: Dossier) {
  const { ingresosMensuales, egresosMensuales, cuotasVigentes, tasaMensual, nMeses, pmtPropuesta } = d.decision;
  const disponible = Math.max(0, ingresosMensuales - egresosMensuales - cuotasVigentes);
  const capacidad = 0.6 * disponible;
  const pmtMax = capacidad;
  const pmax =
    tasaMensual > 0 ? (pmtMax * (1 - Math.pow(1 + tasaMensual, -nMeses))) / tasaMensual : pmtMax * nMeses;
  const dsrRatio = (cuotasVigentes + (pmtPropuesta ?? 0)) / Math.max(1, ingresosMensuales);
  return {
    disponibleMensual: Math.round(disponible),
    capacidadAsignable: Math.round(capacidad),
    pmtMax: Math.round(pmtMax),
    pmax: Math.round(pmax),
    dsr: Math.round(dsrRatio * 100), // % para mostrar
    dsrRatio: Number(dsrRatio.toFixed(4)), // ratio para gates
  };
}

/* =====================================
 * KPIs
 * ===================================== */
function kpisFinancieros(d: Dossier, opts: Required<ScoringOptions>): KPI[] {
  const f = d.financiera;
  const ventas12 = f.ventas; // anual
  const CFO12 = annualize(f.flujoCajaOperativo, opts.periodoFinanciero);
  const P = opts.params;

  const liquidez = f.activosCorrientes / Math.max(1, f.pasivosCorrientes);
  const endeuda = f.pasivosTotales / Math.max(1, f.activosTotales);
  const margen = f.utilidadNeta / Math.max(1, ventas12);

  const rotDataOk = f.inventarioPromedio > 0 && f.costoVentas > 0;
  const rotinv = rotDataOk ? f.costoVentas / Math.max(1, f.inventarioPromedio) : NaN;

  return [
    {
      key: "liquidez",
      label: "Liquidez corriente",
      raw: liquidez,
      unidad: "ratio",
      score: mapLinear(liquidez, 0.8, 2.0),
      fuente: "SCVS",
      hint: "AC/PC",
      categoria: "Financieros",
    },
    {
      key: "endeuda",
      label: "Endeudamiento",
      raw: endeuda,
      unidad: "ratio",
      score: mapLinearInv(endeuda, 0.2, 0.8),
      fuente: "SCVS",
      hint: "PT/AT",
      categoria: "Financieros",
    },
    {
      key: "margen",
      label: "Margen neto",
      raw: margen * 100,
      unidad: "%",
      score: clamp(100 * logistic01(margen, P.margen_k!, P.margen_x0!)),
      fuente: "SCVS",
      hint: "UN/Ventas (anual)",
      categoria: "Financieros",
    },
    {
      key: "rotinv",
      label: "Rotación de inventario",
      raw: rotinv,
      unidad: "veces/año",
      score: isNaN(rotinv) ? 0 : clamp(100 * logistic01(rotinv, P.rotinv_k!, P.rotinv_x0!)),
      fuente: "SCVS",
      hint: "CV/Inv prom.",
      categoria: "Financieros",
      missing: !rotDataOk,
    },
    {
      key: "margen_caja",
      label: "Margen de caja",
      raw: (CFO12 / Math.max(1, ventas12)) * 100,
      unidad: "%",
      score:
        CFO12 <= 0 ? 0 : clamp(100 * logistic01(CFO12 / Math.max(1, ventas12), P.cfoMargin_k!, P.cfoMargin_x0!)),
      fuente: "SCVS (EFE)",
      hint: "CFO12/Ventas12",
      categoria: "Financieros",
    },
  ];
}

function kpisDigitales(d: Dossier): KPI[] {
  const g = d.digital;
  return [
    {
      key: "reputacion",
      label: "Reputación",
      raw: (g.estrellas / 5) * 100,
      unidad: "0–100",
      score: clamp((g.estrellas / 5) * 100),
      fuente: "FB/IG",
      hint: "Estrellas/5",
      categoria: "Digitales",
    },
    {
      key: "volresenas",
      label: "Volumen de reseñas",
      raw: clamp((g.reseñas / 200) * 100),
      unidad: "0–100",
      score: clamp((g.reseñas / 200) * 100),
      fuente: "FB",
      hint: "Cap a 200",
      categoria: "Digitales",
    },
    {
      key: "engagement",
      label: "Engagement/fans",
      raw: clamp((g.fans / 5000) * 100),
      unidad: "0–100",
      score: clamp((g.fans / 5000) * 100),
      fuente: "FB",
      hint: "Cap a 5000",
      categoria: "Digitales",
    },
    {
      key: "sentimiento",
      label: "Sentimiento",
      raw: ((g.sentimiento + 1) / 2) * 100,
      unidad: "0–100",
      score: clamp(((g.sentimiento + 1) / 2) * 100),
      fuente: "IG",
      hint: "[-1..1]→[0..100]",
      categoria: "Digitales",
    },
  ];
}

function kpisComercialLegal(d: Dossier, opts: Required<ScoringOptions>): KPI[] {
  const c: any = d.comercialLegal;
  const P = opts.params;

  // Consistencia IVA (CV bajo = mejor)
  const serie = Array.isArray(c?.ivaPorPagarMensual)
    ? c.ivaPorPagarMensual.filter((x: any) => isFinite(x) && x >= 0)
    : [];
  const n = serie.length;
  const mu = avg(serie);
  const sdev = sd(serie);
  const cv = mu > 0 ? sdev / Math.abs(mu) : NaN;
  const cvUsable = n >= 6 && mu >= 100 && isFinite(cv);

  // Procesos
  const procesosPenales = Number(c?.procesosPenales) || 0;
  const procesosLaborales = Number(c?.procesosLaborales) || 0;
  const penal = procesosPenales * 30 + procesosLaborales * 15;

  // Antigüedad
  const fechaBase = c?.fechaInicioActividades || null;
  const antigAnios = fechaBase ? yearsSince(fechaBase) : NaN;
  const antigScore = isFinite(antigAnios) ? clamp((Math.min(10, antigAnios) / 10) * 100) : 0;

  // Estado RUC
  const estado = String(c?.estadoRuc || "").toUpperCase().trim();
  const estadoScore = estado === "ACTIVO" ? 100 : estado ? 10 : 0;

  // Formalidad SRI
  const toBin = (v: any) =>
    v === true || ["SI", "SÍ", "TRUE", "YES", "1"].includes(String(v ?? "").toUpperCase().trim());
  const malos = (toBin(c?.fantasma) ? 1 : 0) + (toBin(c?.txInexistente) ? 1 : 0);
  const buenos =
    (toBin(c?.obligadoContabilidad) ? 1 : 0) +
    (toBin(c?.agenteRetencion) ? 1 : 0) +
    (toBin(c?.contribuyenteEspecial) ? 1 : 0);
  const formalidadScore = clamp(buenos * 15 - malos * 40, 0, 100);

  // Estabilidad operativa (si hubo cese y reinicio)
  const reinicioISO = c?.fechaReinicioActividades || null;
  const ceseISO = c?.fechaCeseActividades || null;
  const huboCese = !!ceseISO && !!reinicioISO;
  const mesesDesdeReinicio = reinicioISO ? monthsSince(reinicioISO) : NaN;
  const estabScore = huboCese
    ? isFinite(mesesDesdeReinicio)
      ? mapLinear(mesesDesdeReinicio, 6, 24)
      : 0
    : 100;

  // Régimen
  const reg = String(c?.regimen || "").toUpperCase();
  const regScore = reg.includes("GENERAL") ? 100 : reg.includes("RIMPE") ? 85 : reg ? 75 : 0;

  return [
    {
      key: "consistencia",
      label: "Consistencia declaraciones",
      raw: cvUsable ? cv : NaN,
      unidad: "CV",
      score: cvUsable ? mapLinearInv(cv, P.iva_cv_good!, P.iva_cv_bad!) : 0,
      fuente: "SRI",
      hint: "CV 12m; n<6 o μ<100 → missing",
      categoria: "Comercial/Legal",
      missing: !cvUsable,
    },
    {
      key: "mora",
      label: "Mora legal",
      raw: penal,
      unidad: "penalización",
      score: Math.max(0, 100 - penal),
      fuente: "Judicatura",
      hint: "30*penal + 15*laboral",
      categoria: "Comercial/Legal",
    },
    {
      key: "antig",
      label: "Antigüedad",
      raw: antigAnios,
      unidad: "años",
      score: antigScore,
      fuente: "SRI RUC",
      hint: "Cap 10 años",
      categoria: "Comercial/Legal",
      missing: !isFinite(antigAnios),
    },
    {
      key: "estado_ruc",
      label: "Estado RUC",
      raw: estadoScore,
      unidad: "0–100",
      score: estadoScore,
      fuente: "SRI",
      hint: "Activo=100; otros≈10",
      categoria: "Comercial/Legal",
      missing: estado === "",
    },
    {
      key: "formalidad",
      label: "Formalidad SRI",
      raw: formalidadScore,
      unidad: "0–100",
      score: formalidadScore,
      fuente: "SRI",
      hint: "Obligado/AR/Especial +; Fantasma/Tx −",
      categoria: "Comercial/Legal",
    },
    {
      key: "estabilidad",
      label: "Estabilidad operativa",
      raw: isFinite(mesesDesdeReinicio) ? mesesDesdeReinicio : NaN,
      unidad: "meses",
      score: estabScore,
      fuente: "SRI",
      hint: "Meses desde reinicio si hubo cese (6→24)",
      categoria: "Comercial/Legal",
      missing: huboCese ? !isFinite(mesesDesdeReinicio) : false,
    },
    {
      key: "regimen",
      label: "Régimen tributario",
      raw: regScore,
      unidad: "0–100",
      score: regScore,
      fuente: "SRI",
      hint: "General>RIMPE>Otros",
      categoria: "Comercial/Legal",
      missing: !reg,
    },
  ];
}


/* =====================================
 * Cobertura, score ponderado y PD
 * ===================================== */
function scorePorBloque(kpis: KPI[], categoria: KPI["categoria"]) {
  const usados = kpis.filter((k) => k.categoria === categoria && !k.missing);
  return usados.length ? avg(usados.map((k) => k.score)) : 0;
}

function coberturaPonderada(kpis: KPI[], pesos: Required<ScoringOptions>["pesos"]) {
  const cats: KPI["categoria"][] = ["Financieros", "Digitales", "Comercial/Legal"];
  let cov = 0;
  let pesoTotal = 0;
  for (const c of cats) {
    const total = kpis.filter((k) => k.categoria === c).length;
    const usados = kpis.filter((k) => k.categoria === c && !k.missing).length;
    const local = total > 0 ? usados / total : 0;
    const p = (pesos as any)[c];
    cov += local * p;
    pesoTotal += p;
  }
  return pesoTotal > 0 ? cov / pesoTotal : 0;
}

function scoreGlobalPonderado(kpis: KPI[], pesos: Required<ScoringOptions>["pesos"]) {
  return Math.round(
    scorePorBloque(kpis, "Financieros") * pesos.Financieros +
      scorePorBloque(kpis, "Digitales") * pesos.Digitales +
      scorePorBloque(kpis, "Comercial/Legal") * pesos["Comercial/Legal"]
  );
}

function scoreToPD(score: number, cal: { a: number; b: number }) {
  const z = cal.a + cal.b * score;
  const pd = 1 / (1 + Math.exp(-z));
  const rating = score >= 85 ? "A" : score >= 75 ? "B" : score >= 65 ? "C" : score >= 50 ? "D" : "E";
  return { pd: Number((pd * 100).toFixed(2)), rating } as const;
}

/* =====================================
 * Gates y decisión
 * ===================================== */
function evaluarGates(d: Dossier, opts: Required<ScoringOptions>) {
  const f = d.financiera,
    dec = d.decision,
    c: any = d.comercialLegal;
  const CFO12 = annualize(f.flujoCajaOperativo, opts.periodoFinanciero);
  const deuda12 = 12 * (dec.cuotasVigentes + (dec.pmtPropuesta ?? 0));
  const dscr = deuda12 > 0 ? CFO12 / deuda12 : Infinity;
  const dsrRatio = (dec.cuotasVigentes + (dec.pmtPropuesta ?? 0)) / Math.max(1, dec.ingresosMensuales);

  const rucActivo = !c?.estadoRuc || String(c.estadoRuc).toUpperCase() === "ACTIVO";
  const sinFantasma = !c?.fantasma;
  const sinTxInex = !c?.txInexistente;

  const reinicioISO = c?.fechaReinicioActividades || null;
  const mesesReinicio = reinicioISO ? monthsSince(reinicioISO) : Infinity;
  const reinicioReciente = mesesReinicio < 6; // gate duro

  const gate = {
    cfoPositivo: CFO12 > 0,
    dscrOK: dscr >= opts.requires.dscrMin,
    dsrOK: dsrRatio <= opts.requires.dsrMax,
    sinPenal: (c?.procesosPenales ?? 0) === 0,
    rucActivo,
    sinFantasma,
    sinTxInex,
    sinReinicioReciente: !reinicioReciente,
  };
  const pass = gate.cfoPositivo && gate.dscrOK && gate.dsrOK && gate.sinPenal && gate.rucActivo && gate.sinFantasma && gate.sinTxInex && gate.sinReinicioReciente;
  return { pass, dscr, dsrRatio, CFO12, gate } as const;
}

/* =====================================
 * Monto recomendado (con factores por estabilidad y régimen)
 * ===================================== */
function calcularMonto(d: Dossier, derivados: ReturnType<typeof calcularDerivados>, CFO12: number, opts: Required<ScoringOptions>) {
  const ventas12 = d.financiera.ventas;
  const pmax = derivados.pmax; // por capacidad
  const capVentas = opts.limitesMonto.kVentas * Math.max(0, ventas12);
  const capCFO = opts.limitesMonto.mCFO * Math.max(0, CFO12);

  const c: any = d.comercialLegal;
  const reg = String(c?.regimen || "").toUpperCase();
  const reinicioISO = c?.fechaReinicioActividades || null;
  const mesesDesdeReinicio = reinicioISO ? monthsSince(reinicioISO) : Infinity;

  const factorEstab = mesesDesdeReinicio < 6 ? 0.0 : mesesDesdeReinicio < 12 ? 0.6 : mesesDesdeReinicio < 24 ? 0.8 : 1.0;
  const factorRegimen = reg.includes("GENERAL") ? 1.0 : reg.includes("RIMPE") ? 0.9 : reg.includes("POPULAR") ? 0.8 : 0.85;

  const techo = Math.min(pmax, capVentas, capCFO);
  const recomendado = Math.floor(techo * factorEstab * factorRegimen);
  return { pmax, capVentas: Math.floor(capVentas), capCFO: Math.floor(capCFO), recomendado } as const;
}

/* =====================================
 * Merge helper para el parcial legal
 * ===================================== */
function mergeComercialLegal(
  current: Dossier["comercialLegal"] | undefined,
  p: ComercialLegalPartial
): Dossier["comercialLegal"] {
  const base: Dossier["comercialLegal"] =
    current ?? {
      ivaPorPagarMensual: [],
      fechaInicioActividades: "2000-01-01",
      procesosPenales: 0,
      procesosLaborales: 0,
    };

  // helpers
  const has = <K extends keyof ComercialLegalPartial>(k: K) => Object.prototype.hasOwnProperty.call(p, k);
  const toNum = (v: unknown, fallback: number) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
  const toBool = (v: unknown) => {
    if (v === null || typeof v === "undefined") return undefined;
    if (typeof v === "boolean") return v;
    const s = String(v).trim().toUpperCase();
    return ["SI", "SÍ", "TRUE", "YES", "1"].includes(s) ? true : ["NO", "FALSE", "0"].includes(s) ? false : undefined;
  };
    const toISOopt = (v: unknown, fallback?: string): string | undefined => {
    if (typeof v !== "string") return fallback;
    const t = v.trim();
    if (!t) return fallback;
    const d = new Date(t);
    if (isNaN(d.getTime())) return fallback;
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 19);
    };

  const normStr = (v: unknown) => (typeof v === "string" ? v.trim() : undefined);
  const upper = (v: unknown) => (typeof v === "string" ? v.trim().toUpperCase() : undefined);

  // IVA: filtra negativos/NaN, redondea, y limita a 12 últimos si viene una novela
  const ivaSerie = Array.isArray(p.ivaPorPagarMensual)
    ? p.ivaPorPagarMensual
        .filter((x) => Number.isFinite(x) && Number(x) >= 0)
        .map((x) => Math.round(Number(x)))
        .slice(-12)
    : base.ivaPorPagarMensual;

  // build
  return {
    ...base,

    // series
    ivaPorPagarMensual: ivaSerie,

    // fechas (si viene campo, intento normalizar; si no, dejo base)
    fechaInicioActividades: has("fechaInicioActividades")
    ? toISOopt(p.fechaInicioActividades, base.fechaInicioActividades)
    : base.fechaInicioActividades,

    fechaCeseActividades: has("fechaCeseActividades")
      ? toISOopt(p.fechaCeseActividades, base.fechaCeseActividades)
      : base.fechaCeseActividades,
    fechaReinicioActividades: has("fechaReinicioActividades")
      ? toISOopt(p.fechaReinicioActividades, base.fechaReinicioActividades)
      : base.fechaReinicioActividades,

    // contadores (acepta 0 correctamente)
    procesosPenales: has("procesosPenales") ? toNum(p.procesosPenales, base.procesosPenales) : base.procesosPenales,
    procesosLaborales: has("procesosLaborales") ? toNum(p.procesosLaborales, base.procesosLaborales) : base.procesosLaborales,

    // metadatos SRI
    estadoRuc: has("estadoRuc") ? upper(p.estadoRuc) ?? base.estadoRuc : base.estadoRuc,
    fantasma: has("fantasma") ? toBool(p.fantasma) ?? base.fantasma : base.fantasma,
    txInexistente: has("txInexistente") ? toBool(p.txInexistente) ?? base.txInexistente : base.txInexistente,
    obligadoContabilidad: has("obligadoContabilidad")
      ? (typeof p.obligadoContabilidad === "boolean" || p.obligadoContabilidad === null
          ? p.obligadoContabilidad
          : toBool(p.obligadoContabilidad) ?? base.obligadoContabilidad)
      : base.obligadoContabilidad,
    agenteRetencion: has("agenteRetencion")
      ? (typeof p.agenteRetencion === "boolean" || p.agenteRetencion === null
          ? p.agenteRetencion
          : toBool(p.agenteRetencion) ?? base.agenteRetencion)
      : base.agenteRetencion,
    contribuyenteEspecial: has("contribuyenteEspecial")
      ? (typeof p.contribuyenteEspecial === "boolean" || p.contribuyenteEspecial === null
          ? p.contribuyenteEspecial
          : toBool(p.contribuyenteEspecial) ?? base.contribuyenteEspecial)
      : base.contribuyenteEspecial,

    tipoContribuyente: has("tipoContribuyente") ? normStr(p.tipoContribuyente) ?? base.tipoContribuyente : base.tipoContribuyente,
    regimen: has("regimen") ? upper(p.regimen) ?? base.regimen : base.regimen,
  };
}

/* =====================================
 * Cálculo maestro (función pura)
 * ===================================== */
export function calcularModelo(d: Dossier, options?: ScoringOptions) {
  const opts = {
    ...DEFAULT_OPTS,
    ...options,
    pesos: { ...DEFAULT_OPTS.pesos, ...(options?.pesos || {}) },
    umbrales: { ...DEFAULT_OPTS.umbrales, ...(options?.umbrales || {}) },
    requires: { ...DEFAULT_OPTS.requires, ...(options?.requires || {}) },
    limitesMonto: { ...DEFAULT_OPTS.limitesMonto, ...(options?.limitesMonto || {}) },
    params: { ...DEFAULT_OPTS.params, ...(options?.params || {}) },
    calibracion: { ...DEFAULT_OPTS.calibracion, ...(options?.calibracion || {}) },
  } as Required<ScoringOptions>;

  const kpis = [
    ...kpisFinancieros(d, opts),
    ...kpisDigitales(d),
    ...kpisComercialLegal(d, opts)
  ];

  const cobertura = coberturaPonderada(kpis, opts.pesos);
  let scoreGlobal = scoreGlobalPonderado(kpis, opts.pesos);
  if (cobertura < opts.requires.coverageMin) scoreGlobal = Math.min(scoreGlobal, 60);

  const gates = evaluarGates(d, opts);
  const derivados = calcularDerivados(d);
  const montos = calcularMonto(d, derivados, gates.CFO12, opts);

  let decision: "APROBADO" | "APROBADO CONDICIONES" | "REVISION" | "RECHAZO POR POLITICA";
  if (!gates.pass) decision = "RECHAZO POR POLITICA";
  else if (scoreGlobal >= opts.umbrales.aprobado) decision = "APROBADO";
  else if (scoreGlobal >= opts.umbrales.condicionado) decision = "APROBADO CONDICIONES";
  else if (scoreGlobal >= opts.umbrales.revision) decision = "REVISION";
  else decision = "RECHAZO POR POLITICA";

  const grupos = {
    Financieros: kpis.filter(k => k.categoria === "Financieros"),
    Digitales: kpis.filter(k => k.categoria === "Digitales"),
    "Comercial/Legal": kpis.filter(k => k.categoria === "Comercial/Legal"),
  } as const;

  const pd = scoreToPD(scoreGlobal, opts.calibracion);

  return { kpis, grupos, scoreGlobal, cobertura, gates, derivados, montos, decision, pd, options: opts } as const;
}

/* =====================================
 * Hook principal (dinámico) + compatibilidad
 * ===================================== */
export function useKpiScoringV2(initial?: Dossier, options?: ScoringOptions) {
  const [dossier, setDossier] = useState<Dossier | null>(initial ?? null);
  const [loaded, setLoaded] = useState(false);
  const [opts, setOpts] = useState<Required<ScoringOptions>>({
    ...DEFAULT_OPTS,
    ...options,
    pesos: { ...DEFAULT_OPTS.pesos, ...(options?.pesos || {}) },
    umbrales: { ...DEFAULT_OPTS.umbrales, ...(options?.umbrales || {}) },
    requires: { ...DEFAULT_OPTS.requires, ...(options?.requires || {}) },
    limitesMonto: { ...DEFAULT_OPTS.limitesMonto, ...(options?.limitesMonto || {}) },
    params: { ...DEFAULT_OPTS.params, ...(options?.params || {}) },
    calibracion: { ...DEFAULT_OPTS.calibracion, ...(options?.calibracion || {}) },
  });

  const result = useMemo(() => (dossier ? calcularModelo(dossier, opts) : null), [dossier, opts]);

  function simulate(ruc?: string) {
    const mock = { ...MOCK_DOSSIER, ruc: ruc?.trim() || MOCK_DOSSIER.ruc };
    setDossier(mock);
    setLoaded(true);
  }

  function applyLegalPartial(partial: ComercialLegalPartial) {
    setDossier(prev => {
      const base = prev ?? MOCK_DOSSIER;
      return { ...base, comercialLegal: mergeComercialLegal(base.comercialLegal, partial) };
    });
  }

  function setOptions(patch: ScoringOptions) {
    setOpts(prev => ({
      ...prev,
      ...patch,
      pesos: { ...prev.pesos, ...(patch.pesos || {}) },
      umbrales: { ...prev.umbrales, ...(patch.umbrales || {}) },
      requires: { ...prev.requires, ...(patch.requires || {}) },
      limitesMonto: { ...prev.limitesMonto, ...(patch.limitesMonto || {}) },
      params: { ...prev.params, ...(patch.params || {}) },
      calibracion: { ...prev.calibracion, ...(patch.calibracion || {}) },
    }));
  }

  return {
    loaded,
    simulate,
    dossier,
    setDossier,
    kpis: result?.kpis ?? [],
    grupos: result?.grupos ?? { Financieros: [], Digitales: [], "Comercial/Legal": [] },
    derivados: result?.derivados ?? ({ disponibleMensual: 0, capacidadAsignable: 0, pmtMax: 0, pmax: 0, dsr: 0, dsrRatio: 0 } as const),
    montos: result?.montos ?? ({ pmax: 0, capVentas: 0, capCFO: 0, recomendado: 0 } as const),
    cobertura: result?.cobertura ?? 0,
    gates: result?.gates ?? ({ pass: false, dscr: 0, dsrRatio: 0, CFO12: 0, gate: { cfoPositivo: false, dscrOK: false, dsrOK: false, sinPenal: false, rucActivo: false, sinFantasma: false, sinTxInex: false, sinReinicioReciente: false } } as const),
    scoreGlobal: result?.scoreGlobal ?? 0,
    decision: result?.decision ?? "RECHAZO POR POLITICA",
    pd: result?.pd ?? { pd: 0, rating: "E" },
    options: opts,
    applyLegalPartial,
    setOptions,
  } as const;
}
