import React from "react";

const InfoTip: React.FC<{ text: React.ReactNode }> = ({ text }) => (
  <span className="info-tip" tabIndex={0} aria-label={typeof text === "string" ? text : "Información"}>
    i
    <span className="info-bubble" role="tooltip">{text}</span>
  </span>
);

export default InfoTip;
