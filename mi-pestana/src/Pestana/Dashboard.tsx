import React, { useEffect, useState } from "react";
import { useKpiScoringV2} from "../hooks/useKpiScoringDemo";

const InfoTip: React.FC<{ text: React.ReactNode }> = ({ text }) => (
  <span className="info-tip" tabIndex={0} aria-label={typeof text === "string" ? text : "Información"}>
    i
    <span className="info-bubble" role="tooltip">{text}</span>
  </span>
);

const KpiCard: React.FC<{ title: string; value: string; score: number; hint?: string; fuente?: string; }> =
({ title, value, score, hint, fuente }) => (
  <div className="kpi-card">
    <div className="kpi-title">
      {title}
      <InfoTip text={<>
        <b>{title}</b><br />
        {hint || "Sin descripción"}<br />
        <i>Fuente: {fuente || "-"}</i>
      </>} />
    </div>
    <div className="kpi-value">{value}</div>
    <div className="kpi-bar"><div className="kpi-fill" style={{ width: `${Math.round(score)}%` }} /></div>
    <div className="kpi-score">{Math.round(score)} / 100</div>
  </div>
);

const fmt = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(2));
const fmtUSD = (x: number) => new Intl.NumberFormat("es-EC", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(x);
const pct = (x: number, digits = 0) => `${x.toFixed(digits)}%`;

function badgeStyle(kind: "ok" | "warn" | "bad") {
  const base: React.CSSProperties = { padding: "2px 8px", borderRadius: 999, fontSize: 12, fontWeight: 600 };
  if (kind === "ok") return { ...base, background: "rgba(0,160,80,.15)", color: "#0b8a47", border: "1px solid rgba(0,160,80,.35)" };
  if (kind === "warn") return { ...base, background: "rgba(230,165,0,.15)", color: "#c07a00", border: "1px solid rgba(230,165,0,.35)" };
  return { ...base, background: "rgba(210,50,50,.15)", color: "#b82222", border: "1px solid rgba(210,50,50,.35)" };
}

const Dashboard: React.FC = () => {
  const [ruc, setRuc] = useState("");
  const { loaded, simulate, grupos, derivados, scoreGlobal, decision, cobertura, gates } = useKpiScoringV2();

  useEffect(() => {
    if (!loaded) simulate(ruc);
  }, [loaded, ruc, simulate]);

  const gateBadges = [
    {
      label: "CFO 12m > 0",
      pass: gates?.gate?.cfoPositivo ?? false,
      extra: gates ? fmtUSD(gates.CFO12 || 0) : "",
      info: "Flujo de caja operativo (anual). Debe ser positivo."
    },
    {
      label: "DSCR ≥ 1.20",
      pass: gates?.gate?.dscrOK ?? false,
      extra: gates && isFinite(gates.dscr) ? gates.dscr.toFixed(2) : "-",
      info: "Debt Service Coverage Ratio."
    },
    {
      label: "DSR ≤ 35%",
      pass: gates?.gate?.dsrOK ?? false,
      extra: gates ? pct((gates.dsrRatio || 0) * 100) : "-",
      info: "Debt Service Ratio mensual."
    },
    {
      label: "Sin procesos penales",
      pass: gates?.gate?.sinPenal ?? false,
      extra: "",
      info: "No se aprueba si hay procesos penales activos."
    }
  ];

  const decisionKind: "ok" | "warn" | "bad" =
    decision === "APROBADO" ? "ok" :
    decision === "APROBADO CONDICIONES" || decision === "REVISION" ? "warn" : "bad";

  return (
    <div className="chat-kpi-wrap">
      <div className="card tone-chat" style={{ marginBottom: 12 }}>
        <div className="card-header">
          <h3>Demo de Scoring</h3><span className="badge">Mock</span>
        </div>
        <div className="kpi-upload-body" style={{ display: "grid", gap: 8 }}>
          <label>RUC</label>
          <input value={ruc} onChange={(e) => setRuc(e.target.value)} placeholder="Ingresa RUC (demo)" />
          <small>Se usan datos quemados del hook. No hay backend todavía.</small>
        </div>
      </div>

      {!loaded && (
        <div className="card tone-chat" style={{ padding: 20, opacity: .85 }}>
          Cargando demo… preparando KPIs con JSON mock.
        </div>
      )}

      {loaded && (
        <>
          <div className="kpi-score-summary card tone-chat">
            <div className="score-ring" style={{ ["--p" as any]: `${scoreGlobal}%` }}>
              <div className="ring-center">
                {scoreGlobal}
                <InfoTip text="Score ponderado por bloques: 70% financieros, 20% comercial/legal, 10% digitales." />
              </div>
            </div>

            <div className="derivados">
              <div style={{ marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
                <span style={badgeStyle(decisionKind)}>{decision}</span>
                <span style={{ fontSize: 12, opacity: .8 }}>Cobertura: {(cobertura * 100).toFixed(0)}%</span>
                <InfoTip text="Cobertura de KPIs válidos." />
              </div>

              <div><b>Disponible mensual:</b> {fmtUSD(derivados.disponibleMensual)}</div>
              <div><b>Capacidad (60%):</b> {fmtUSD(derivados.capacidadAsignable)}</div>
              <div><b>PMT máx.:</b> {fmtUSD(derivados.pmtMax)}</div>
              <div><b>Pmax (por capacidad):</b> {fmtUSD(derivados.pmax)}</div>
              <div><b>DSR:</b> {pct(derivados.dsr)}</div>
            </div>
          </div>

          <div className="card tone-chat" style={{ padding: 14 }}>
            <div className="kpi-section-head" style={{ marginBottom: 8 }}>
              <h4>Políticas (gates)</h4>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px,1fr))", gap: 8 }}>
              {gateBadges.map(g => (
                <div key={g.label} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={badgeStyle(g.pass ? "ok" : "bad")}>{g.pass ? "OK" : "Falla"}</span>
                  <div>
                    <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                      <span style={{ fontWeight: 600 }}>{g.label}</span>
                      <InfoTip text={g.info} />
                    </div>
                    {g.extra ? <small style={{ opacity: .8 }}>{g.extra}</small> : null}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {Object.entries(grupos).map(([nombre, lista]) => (
            <div className="card tone-chat kpi-section" key={nombre}>
              <div className="kpi-section-head">
                <h4>KPIs {nombre}</h4>
              </div>
              <div className="kpi-grid">
                {lista.map((k: any) => (
                  <KpiCard
                    key={k.key}
                    title={k.label}
                    value={`${Number.isFinite(k.raw) ? fmt(k.raw) : "—"} ${k.unidad || ""}`.trim()}
                    score={k.score}
                    hint={k.hint}
                    fuente={k.fuente}
                  />
                ))}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
};

export default Dashboard;
