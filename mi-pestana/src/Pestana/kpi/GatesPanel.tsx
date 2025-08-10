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

type Gates = any;

const GatesPanel: React.FC<{ gates: Gates | null | undefined }> = ({ gates }) => {
  const items = [
    {
      label: "CFO 12m > 0",
      pass: gates?.gate?.cfoPositivo ?? false,
      extra: gates ? fmtUSD(gates.CFO12 || 0) : "",
      info: "Flujo de caja operativo (anual). Debe ser positivo para no financiar pérdidas operativas."
    },
    {
      label: "DSCR ≥ 1.20",
      pass: gates?.gate?.dscrOK ?? false,
      extra: gates && isFinite(gates.dscr) ? gates.dscr.toFixed(2) : "-",
      info: "Debt Service Coverage Ratio: CFO_12m / Servicio_de_Deuda_12m."
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
    },
    {
      label: "RUC activo",
      pass: gates?.gate?.rucActivo ?? false,
      extra: "",
      info: "El estado del RUC debe estar ACTIVO."
    },
    {
      label: "Sin contribuyente fantasma",
      pass: gates?.gate?.sinFantasma ?? false,
      extra: "",
      info: "Si es 'fantasma' se rechaza por política."
    },
    {
      label: "Sin transacciones inexistentes",
      pass: gates?.gate?.sinTxInex ?? false,
      extra: "",
      info: "Marcado por SRI con transacciones inexistentes → rechazo."
    },
    {
      label: "Sin reinicio reciente (<6m)",
      pass: gates?.gate?.sinReinicioReciente ?? false,
      extra: "",
      info: "Si hubo cese y reinicio hace < 6 meses, se rechaza por política."
    }
  ];

  return (
    <div className="card tone-chat" style={{ padding: 14 }}>
      <div className="kpi-section-head" style={{ marginBottom: 8 }}>
        <h4 style={{ margin: 0 }}>Políticas (gates)</h4>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px,1fr))", gap: 8 }}>
        {items.map(g => (
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
  );
};

export default GatesPanel;
