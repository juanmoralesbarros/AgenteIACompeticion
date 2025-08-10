import React from "react";
import InfoTip from "../../components/InfoTip";

function badgeStyle(kind: "ok" | "warn" | "bad") {
  const base: React.CSSProperties = { padding: "2px 8px", borderRadius: 999, fontSize: 12, fontWeight: 600 };
  if (kind === "ok") return { ...base, background: "rgba(0,160,80,.15)", color: "#0b8a47", border: "1px solid rgba(0,160,80,.35)" };
  if (kind === "warn") return { ...base, background: "rgba(230,165,0,.15)", color: "#c07a00", border: "1px solid rgba(230,165,0,.35)" };
  return { ...base, background: "rgba(210,50,50,.15)", color: "#b82222", border: "1px solid rgba(210,50,50,.35)" };
}

const fmtUSD = (x: number) =>
  new Intl.NumberFormat("es-EC", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(x);
const pct = (x: number, digits = 0) => `${x.toFixed(digits)}%`;

type Props = {
  scoreGlobal: number;
  decision: string;
  cobertura: number;
  pd: { pd: number; rating: string };
  derivados: {
    disponibleMensual: number;
    capacidadAsignable: number;
    pmtMax: number;
    pmax: number;
    dsr: number;
  };
};

const ScoreSummary: React.FC<Props> = ({ scoreGlobal, decision, cobertura, pd, derivados }) => {
  const decisionKind: "ok" | "warn" | "bad" =
    decision === "APROBADO" ? "ok" :
    decision === "APROBADO CONDICIONES" || decision === "REVISION" ? "warn" : "bad";

  return (
    <div className="kpi-score-summary card tone-chat">
      <div className="score-ring" style={{ ["--p" as any]: `${scoreGlobal}%` }}>
        <div className="ring-center">
          {scoreGlobal}
          <InfoTip text="Score ponderado por bloques: 70% financieros, 20% comercial/legal, 10% digitales." />
        </div>
      </div>

      <div className="derivados">
        <div style={{ marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ ...badgeStyle(decisionKind) }}>{decision}</span>
          <span style={{ fontSize: 12, opacity: .8 }}>
            Cobertura: {(cobertura * 100).toFixed(0)}%
          </span>
          <span style={{ fontSize: 12, opacity: .8 }}>
            PD: {pd.pd}% · Rating: {pd.rating}
          </span>
          <InfoTip text="PD calibrada con logística simple: PD = 1/(1+e^{-(a+b*score)})." />
        </div>

        <div><b>Disponible mensual:</b> {fmtUSD(derivados.disponibleMensual)}</div>
        <div><b>Capacidad (60%):</b> {fmtUSD(derivados.capacidadAsignable)}</div>
        <div><b>PMT máx.:</b> {fmtUSD(derivados.pmtMax)}</div>
        <div><b>Pmax (por capacidad):</b> {fmtUSD(derivados.pmax)}</div>
        <div><b>DSR:</b> {pct(derivados.dsr)}</div>
      </div>
    </div>
  );
};

export default ScoreSummary;
