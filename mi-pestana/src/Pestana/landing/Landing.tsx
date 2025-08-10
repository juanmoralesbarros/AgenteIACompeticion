import React from "react";
import Chip from "../../components/Chip";

const Landing: React.FC<{ onGoKpi: () => void; onGoRealtime: () => void; }> = ({ onGoKpi, onGoRealtime }) => (
  <div className="chat-landing in-body">
    <div className="chat-landing-inner">
      <div className="chat-logo">◎</div>
      <h3>Bienvenido a AgenteIA</h3>
      <p className="hint">
        Conecta una red social o carga un archivo para empezar.<br />
        También puedes preguntarme cómo preparar tus datos.
      </p>
      <div className="quick-examples">
        <Chip>¿Qué formatos de archivo aceptas?</Chip>
        <Chip>¿Cómo conecto mi cuenta de Instagram?</Chip>
        <Chip onClick={onGoKpi}>Muestra un ejemplo de scoring</Chip>
        <Chip onClick={onGoRealtime}>Abrir chat en tiempo real</Chip>
      </div>
    </div>
  </div>
);

export default Landing;
