import React from "react";
import "./Pestana.css";

type Props = {
  title: string;
  value: string;
  score: number;
  hint?: string;
  fuente?: string;
};

const KpiCard: React.FC<Props> = ({ title, value, score, hint, fuente }) => {
  return (
    <div className="kpi-card" title={`${hint || ""} • Fuente: ${fuente || "-"}`}>
      <div className="kpi-title">{title}</div>
      <div className="kpi-value">{value}</div>
      <div className="kpi-bar">
        <div className="kpi-fill" style={{ width: `${Math.round(score)}%` }} />
      </div>
      <div className="kpi-score">{Math.round(score)} / 100</div>
    </div>
  );
};

export default KpiCard;
