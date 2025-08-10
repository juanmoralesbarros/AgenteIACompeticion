import React from "react";
import KpiCard from "./KpiCard";

const fmt = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(2));

type Props = {
  grupos: Record<string, any[]>;
};

const KpiGroups: React.FC<Props> = ({ grupos }) => {
  return (
    <>
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
  );
};

export default KpiGroups;
