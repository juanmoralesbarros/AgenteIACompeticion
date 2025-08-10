import React from "react";
import InfoTip from "../../components/InfoTip";

type Props = {
  title: string;
  value: string;
  score: number;
  hint?: string;
  fuente?: string;
};

const KpiCard: React.FC<Props> = ({ title, value, score, hint, fuente }) => (
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

export default KpiCard;
