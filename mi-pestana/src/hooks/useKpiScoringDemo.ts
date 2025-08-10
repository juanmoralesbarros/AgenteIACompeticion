// scoring-v2.ts
import { useMemo, useState } from "react";

/* ===== Tipos base (idénticos a los tuyos) ===== */
export type Dossier = {
  ruc: string;
  financiera: {
    activosCorrientes: number;
    pasivosCorrientes: number;
    pasivosTotales: number;
    activosTotales: number;
    utilidadNeta: number;        // anual
    ventas: number;              // anual
    costoVentas: number;         // anual
    inventarioPromedio: number;
    flujoCajaOperativo: number;  // mensual o anual según options.periodoFinanciero
  };
  digital: { estrellas: number; reseñas: number; fans: number; sentimiento: number };
  comercialLegal: {
    ivaPorPagarMensual: number[]; // ideal 12
    procesosPenales: number;
    procesosLaborales: number;
    fechaInicioActividades: string; // ISO
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

export type KPI = {
  key: string;
  label: string;
  raw: number;   // puede ser NaN si missing
  unidad: string;
  score: number; // 0..100
  fuente: string;
  hint: string;
  categoria: "Financieros" | "Digitales" | "Comercial/Legal";
  missing?: boolean;
};

/* ===== Opciones del motor ===== */
type PeriodoFinanciero = "mensual" | "anual";
export type ScoringOptions = {
  periodoFinanciero?: PeriodoFinanciero; // cómo viene CFO (default: "anual")
  pesos?: { Financieros: number; Digitales: number; "Comercial/Legal": number };
  umbrales?: { aprobado: number; condicionado: number; revision: number };
  requires?: { coverageMin: number; dsrMax: number; dscrMin: number };
  limitesMonto?: { kVentas: number; mCFO: number };
};

const DEFAULT_OPTS: Required<ScoringOptions> = {
  periodoFinanciero: "anual",
  pesos: { Financieros: 0.7, Digitales: 0.1, "Comercial/Legal": 0.2 },
  umbrales: { aprobado: 80, condicionado: 65, revision: 50 },
  requires: { coverageMin: 0.7, dsrMax: 0.35, dscrMin: 1.2 },
  limitesMonto: { kVentas: 0.25, mCFO: 8 }
};

/* ===== Mock (igual al tuyo) ===== */
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
    flujoCajaOperativo: 21000 // por defecto se interpreta como ANUAL (ver options)
  },
  digital: { estrellas: 4.3, reseñas: 156, fans: 2450, sentimiento: 0.35 },
  comercialLegal: {
    ivaPorPagarMensual: [1200,1150,1180,1210,1190,1205,1202,1198,1201,1203,1204,1206],
    procesosPenales: 0,
    procesosLaborales: 1,
    fechaInicioActividades: "2016-05-10"
  },
  decision: {
    ingresosMensuales: 42000,
    egresosMensuales: 28000,
    cuotasVigentes: 3500,
    tasaMensual: 0.025,
    nMeses: 24,
    pmtPropuesta: 1200
  }
};

/* ===== Helpers numéricos ===== */
const clamp = (x:number,min=0,max=100)=>Math.max(min,Math.min(max,x));
const mapLinear = (x:number, xmin:number, xmax:number)=>{
  if (!isFinite(x)) return 0;
  if (x<=xmin) return 0;
  if (x>=xmax) return 100;
  return ((x - xmin) / (xmax - xmin)) * 100;
};
const mapLinearInv = (x:number, xmin:number, xmax:number)=>100 - mapLinear(x, xmin, xmax);
const avg = (a:number[]) => a.length ? a.reduce((x,y)=>x+y,0)/a.length : 0;
const sd = (a:number[]) => { if (!a.length) return 0; const m=avg(a); return Math.sqrt(avg(a.map(x=>(x-m)**2))); };
const yearsSince = (iso:string)=> (Date.now()-new Date(iso).getTime())/(365.25*24*3600*1000);
const logistic01 = (x:number, k:number, x0:number)=> 1/(1+Math.exp(-k*(x-x0)));
const annualize = (val:number, periodo:PeriodoFinanciero)=> periodo==="mensual" ? val*12 : val;

/* ===== Derivados de capacidad (mantiene compatibilidad) ===== */
function calcularDerivados(d:Dossier){
  const { ingresosMensuales, egresosMensuales, cuotasVigentes, tasaMensual, nMeses, pmtPropuesta }=d.decision;
  const disponible = Math.max(0, ingresosMensuales - egresosMensuales - cuotasVigentes);
  const capacidad = 0.60*disponible;
  const pmtMax = capacidad;
  const pmax = tasaMensual>0 ? pmtMax*(1-Math.pow(1+tasaMensual,-nMeses))/tasaMensual : pmtMax*nMeses;
  const dsrRatio = (cuotasVigentes + (pmtPropuesta??0)) / Math.max(1, ingresosMensuales);
  return {
    disponibleMensual: Math.round(disponible),
    capacidadAsignable: Math.round(capacidad),
    pmtMax: Math.round(pmtMax),
    pmax: Math.round(pmax),
    dsr: Math.round(dsrRatio*100),   // % como en tu versión
    dsrRatio: Number(dsrRatio.toFixed(4)) // ratio para gates
  };
}

/* ===== KPIs ===== */
function kpisFinancieros(d:Dossier, opts:Required<ScoringOptions>): KPI[] {
  const f = d.financiera;
  const ventas12 = f.ventas; // anual
  const CFO12 = annualize(f.flujoCajaOperativo, opts.periodoFinanciero);

  const liquidez = f.activosCorrientes/Math.max(1,f.pasivosCorrientes);
  const endeuda = f.pasivosTotales/Math.max(1,f.activosTotales);
  const margen = f.utilidadNeta/Math.max(1,ventas12);

  const rotDataOk = f.inventarioPromedio>0 && f.costoVentas>0;
  const rotinv = rotDataOk ? f.costoVentas/Math.max(1,f.inventarioPromedio) : NaN;

  return [
    { key:"liquidez", label:"Liquidez corriente", raw:liquidez, unidad:"ratio",
      score: mapLinear(liquidez,0.8,2.0), fuente:"SCVS", hint:"AC/PC", categoria:"Financieros" },
    { key:"endeuda", label:"Endeudamiento", raw:endeuda, unidad:"ratio",
      score: mapLinearInv(endeuda,0.2,0.8), fuente:"SCVS", hint:"PT/AT", categoria:"Financieros" },
    { key:"margen", label:"Margen neto", raw:margen*100, unidad:"%",
      score: clamp(100*logistic01(margen, 60, 0.06)), fuente:"SCVS", hint:"UN/Ventas (anual)", categoria:"Financieros" },
    { key:"rotinv", label:"Rotación de inventario", raw:rotinv, unidad:"veces/año",
      score: isNaN(rotinv) ? 0 : clamp(100*logistic01(rotinv, 0.7, 6)), fuente:"SCVS", hint:"CV/Inv prom.", categoria:"Financieros", missing: !rotDataOk },
    { key:"margen_caja", label:"Margen de caja", raw:(CFO12/Math.max(1,ventas12))*100, unidad:"%",
      score: CFO12<=0 ? 0 : clamp(100*logistic01(CFO12/Math.max(1,ventas12), 50, 0.05)),
      fuente:"SCVS (EFE)", hint:"CFO12/Ventas12", categoria:"Financieros" },
  ];
}

function kpisDigitales(d:Dossier): KPI[] {
  const g = d.digital;
  return [
    { key:"reputacion", label:"Reputación", raw:(g.estrellas/5)*100, unidad:"0–100",
      score: clamp((g.estrellas/5)*100), fuente:"FB/IG", hint:"Estrellas/5", categoria:"Digitales" },
    { key:"volresenas", label:"Volumen de reseñas", raw:clamp((g.reseñas/200)*100), unidad:"0–100",
      score: clamp((g.reseñas/200)*100), fuente:"FB", hint:"Cap a 200", categoria:"Digitales" },
    { key:"engagement", label:"Engagement/fans", raw:clamp((g.fans/5000)*100), unidad:"0–100",
      score: clamp((g.fans/5000)*100), fuente:"FB", hint:"Cap a 5000", categoria:"Digitales" },
    { key:"sentimiento", label:"Sentimiento", raw:((g.sentimiento+1)/2)*100, unidad:"0–100",
      score: clamp(((g.sentimiento+1)/2)*100), fuente:"IG", hint:"[-1..1]→[0..100]", categoria:"Digitales" },
  ];
}

function kpisComercialLegal(d:Dossier): KPI[] {
  const c = d.comercialLegal;
  const serie = Array.isArray(c.ivaPorPagarMensual) ? c.ivaPorPagarMensual.filter(x=>isFinite(x) && x>=0) : [];
  const n = serie.length; const mu = avg(serie); const sdev = sd(serie);
  const cv = mu>0 ? sdev/Math.abs(mu) : NaN;
  const cvUsable = (n>=6 && mu>=100 && isFinite(cv));

  const penal = (c.procesosPenales*30 + c.procesosLaborales*15);

  return [
    { key:"consistencia", label:"Consistencia declaraciones", raw: cvUsable ? cv : NaN, unidad:"CV",
      score: cvUsable ? clamp(100 - mapLinear(cv, 0.05, 0.30)) : 0,
      fuente:"SRI", hint:"CV 12m; n<6 o μ<100 → missing", categoria:"Comercial/Legal", missing: !cvUsable },
    { key:"mora", label:"Mora legal", raw: penal, unidad:"penalización",
      score: Math.max(0,100-penal), fuente:"Judicatura", hint:"30*penal + 15*laboral", categoria:"Comercial/Legal" },
    { key:"antig", label:"Antigüedad", raw:yearsSince(c.fechaInicioActividades), unidad:"años",
      score: clamp((Math.min(10,yearsSince(c.fechaInicioActividades))/10)*100), fuente:"SRI RUC", hint:"Cap 10 años", categoria:"Comercial/Legal" }
  ];
}

/* ===== Cobertura y score ponderado ===== */
function scorePorBloque(kpis: KPI[], categoria: KPI["categoria"]) {
  const usados = kpis.filter(k=>k.categoria===categoria && !k.missing);
  return usados.length ? avg(usados.map(k=>k.score)) : 0;
}

function coberturaPonderada(kpis: KPI[], pesos:Required<ScoringOptions>["pesos"]) {
  const cats:(KPI["categoria"])[] = ["Financieros","Digitales","Comercial/Legal"];
  let cov = 0; let pesoTotal = 0;
  for (const c of cats){
    const total = kpis.filter(k=>k.categoria===c).length;
    const usados = kpis.filter(k=>k.categoria===c && !k.missing).length;
    const local = total>0 ? usados/total : 0;
    const p = (pesos as any)[c];
    cov += local*p; pesoTotal += p;
  }
  return pesoTotal>0 ? cov/pesoTotal : 0;
}

function scoreGlobalPonderado(kpis: KPI[], pesos:Required<ScoringOptions>["pesos"]) {
  return Math.round(
    scorePorBloque(kpis,"Financieros")*pesos.Financieros +
    scorePorBloque(kpis,"Digitales")*pesos.Digitales +
    scorePorBloque(kpis,"Comercial/Legal")*pesos["Comercial/Legal"]
  );
}

/* ===== Gates y decisión ===== */
function evaluarGates(d:Dossier, opts:Required<ScoringOptions>) {
  const f=d.financiera, dec=d.decision, c=d.comercialLegal;
  const CFO12 = annualize(f.flujoCajaOperativo, opts.periodoFinanciero);
  const deuda12 = 12*(dec.cuotasVigentes + (dec.pmtPropuesta ?? 0));
  const dscr = deuda12>0 ? CFO12/ deuda12 : Infinity;
  const dsrRatio = (dec.cuotasVigentes + (dec.pmtPropuesta ?? 0)) / Math.max(1, dec.ingresosMensuales);

  const gate = {
    cfoPositivo: CFO12>0,
    dscrOK: dscr >= opts.requires.dscrMin,
    dsrOK: dsrRatio <= opts.requires.dsrMax,
    sinPenal: (c.procesosPenales ?? 0) === 0,
  };
  const pass = gate.cfoPositivo && gate.dscrOK && gate.dsrOK && gate.sinPenal;
  return { pass, dscr, dsrRatio, CFO12, gate };
}

function calcularMonto(d:Dossier, derivados:ReturnType<typeof calcularDerivados>, CFO12:number, opts:Required<ScoringOptions>) {
  const ventas12 = d.financiera.ventas;
  const pmax = derivados.pmax; // por capacidad
  const capVentas = opts.limitesMonto.kVentas * Math.max(0, ventas12);
  const capCFO = opts.limitesMonto.mCFO * Math.max(0, CFO12);
  const recomendado = Math.floor(Math.min(pmax, capVentas, capCFO));
  return { pmax, capVentas: Math.floor(capVentas), capCFO: Math.floor(capCFO), recomendado };
}

/* ===== Cálculo maestro ===== */
export function calcularModelo(d:Dossier, options?: ScoringOptions){
  const opts = { ...DEFAULT_OPTS, ...options } as Required<ScoringOptions>;
  const kpis = [ ...kpisFinancieros(d, opts), ...kpisDigitales(d), ...kpisComercialLegal(d) ];

  const cobertura = coberturaPonderada(kpis, opts.pesos);
  let scoreGlobal = scoreGlobalPonderado(kpis, opts.pesos);
  if (cobertura < opts.requires.coverageMin) scoreGlobal = Math.min(scoreGlobal, 60);

  const gates = evaluarGates(d, opts);
  const derivados = calcularDerivados(d);
  const montos = calcularMonto(d, derivados, gates.CFO12, opts);

  let decision: "APROBADO"|"APROBADO CONDICIONES"|"REVISION"|"RECHAZO POR POLITICA";
  if (!gates.pass) decision = "RECHAZO POR POLITICA";
  else if (scoreGlobal >= opts.umbrales.aprobado) decision = "APROBADO";
  else if (scoreGlobal >= opts.umbrales.condicionado) decision = "APROBADO CONDICIONES";
  else if (scoreGlobal >= opts.umbrales.revision) decision = "REVISION";
  else decision = "RECHAZO POR POLITICA";

  const grupos = {
    Financieros: kpis.filter(k=>k.categoria==="Financieros"),
    Digitales: kpis.filter(k=>k.categoria==="Digitales"),
    "Comercial/Legal": kpis.filter(k=>k.categoria==="Comercial/Legal")
  };

  return { kpis, grupos, scoreGlobal, cobertura, gates, derivados, montos, decision, options: opts };
}

/* ===== Hook nuevo ===== */
export function useKpiScoringV2(initial?: Dossier, options?: ScoringOptions) {
  const [dossier, setDossier] = useState<Dossier | null>(initial ?? null);
  const [loaded, setLoaded] = useState(false);

  const result = useMemo(() => dossier ? calcularModelo(dossier, options) : null, [dossier, options]);

  function simulate(ruc?: string) {
    const mock = { ...MOCK_DOSSIER, ruc: ruc?.trim() || MOCK_DOSSIER.ruc };
    setDossier(mock);
    setLoaded(true);
  }

  return {
    loaded,
    simulate,
    dossier, setDossier,
    kpis: result?.kpis ?? [],
    grupos: result?.grupos ?? { Financieros:[], Digitales:[], "Comercial/Legal":[] },
    derivados: result?.derivados ?? { disponibleMensual:0, capacidadAsignable:0, pmtMax:0, pmax:0, dsr:0, dsrRatio:0 },
    montos: result?.montos ?? { pmax:0, capVentas:0, capCFO:0, recomendado:0 },
    cobertura: result?.cobertura ?? 0,
    gates: result?.gates ?? { pass:false, dscr:0, dsrRatio:0, CFO12:0, gate:{ cfoPositivo:false, dscrOK:false, dsrOK:false, sinPenal:false } },
    scoreGlobal: result?.scoreGlobal ?? 0,
    decision: result?.decision ?? "RECHAZO POR POLITICA"
  };
}

/* ===== Hook COMPATIBLE con tu antiguo nombre/shape ===== */
export function useKpiScoringDemo(initial?: Dossier) {
  // usa v2 por debajo con defaults
  const v2 = useKpiScoringV2(initial, { periodoFinanciero: "anual" });
  // devuelve el mismo “shape” que tu hook original, para no romper consumo
  return {
    loaded: v2.loaded,
    simulate: v2.simulate,
    dossier: v2.dossier,
    kpis: v2.kpis,
    grupos: v2.grupos,
    derivados: {
      // mantiene los mismos campos, con dsr en %
      disponibleMensual: v2.derivados.disponibleMensual,
      capacidadAsignable: v2.derivados.capacidadAsignable,
      pmtMax: v2.derivados.pmtMax,
      pmax: v2.derivados.pmax,
      dsr: v2.derivados.dsr
    },
    scoreGlobal: v2.scoreGlobal,
    // extras útiles que antes no tenías
    cobertura: v2.cobertura,
    gates: v2.gates,
    montos: v2.montos,
    decision: v2.decision
  };
}
