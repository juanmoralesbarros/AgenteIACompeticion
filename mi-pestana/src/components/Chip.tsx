import React from "react";

const Chip: React.FC<{ onClick?: () => void; children: React.ReactNode }> = ({ onClick, children }) => (
  <span className="chip" onClick={onClick} role="button" tabIndex={0}>{children}</span>
);

export default Chip;
