import React, { useEffect, useState } from "react";
import "./Chat.css";

import { useKpiScoringV2 } from "../hooks/useKpiScoringDemo";
import LegalNomina from "./legal/LegalNomina";
import SRI from "./legal/SRI";

import Landing from "../Pestana/landing/Landing";
import ScoreSummary from "../Pestana/kpi/ScoreSummary";
import GatesPanel from "../Pestana/kpi/GatesPanel";
import KpiGroups from "../Pestana/kpi/KpiGroups";
import RealtimeChat from "../Pestana/realtime/RealtimeChat";

const Chat: React.FC = () => {
  const [mode, setMode] = useState<"landing" | "kpi" | "realtime">("landing");
  const [ruc, setRuc] = useState("");

  const {
    loaded, simulate, grupos, derivados, scoreGlobal, decision, cobertura, gates, pd,
    applyLegalPartial
  } = useKpiScoringV2();

  useEffect(() => {
    if (mode === "kpi" && !loaded) simulate(ruc);
  }, [mode, loaded, ruc, simulate]);

  return (
    <div className="card tone-chat card-chat">
      <header className="chat-header">
        <h2>Chatbot</h2>
        <p>Interactúa con tu asistente</p>

        <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
          <button type="button" className={`send-btn subtle ${mode === "landing" ? "active" : ""}`} onClick={() => setMode("landing")}>Landing</button>
          <button type="button" className={`send-btn subtle ${mode === "kpi" ? "active" : ""}`} onClick={() => setMode("kpi")}>Scoring (KPI)</button>
          <button type="button" className={`send-btn subtle ${mode === "realtime" ? "active" : ""}`} onClick={() => setMode("realtime")}>Chat tiempo real</button>
        </div>
      </header>

      <div className="chat-body">
        {mode === "landing" && (
          <Landing onGoKpi={() => setMode("kpi")} onGoRealtime={() => setMode("realtime")} />
        )}

        {mode === "kpi" && (
          <div className="chat-kpi-wrap">
            <div className="card tone-chat" style={{ marginBottom: 12 }}>
              <div className="card-header">
                <h3>Nómina de administradores</h3><span className="badge">Batch Judicial</span>
              </div>
              <LegalNomina
                onUseInScoring={(partial) => applyLegalPartial(partial)}
                defaultEmpresaRuc={ruc}
                defaultRepresentantes={[]}
              />
            </div>

            <div className="card tone-chat" style={{ marginBottom: 12 }}>
              <div className="card-header">
                <h3>Demo de Scoring</h3><span className="badge">Mock + SRI</span>
              </div>
              <SRI ruc={ruc} onChangeRuc={setRuc} onApplyPartial={applyLegalPartial} />
            </div>

            {!loaded && (
              <div className="card tone-chat" style={{ padding: 20, opacity: .85 }}>
                Cargando demo… preparando KPIs con JSON mock.
              </div>
            )}

            {loaded && (
              <>
                <ScoreSummary
                  scoreGlobal={scoreGlobal}
                  decision={decision}
                  cobertura={cobertura}
                  pd={pd}
                  derivados={derivados}
                />
                <GatesPanel gates={gates} />
                <KpiGroups grupos={grupos as any} />
              </>
            )}
          </div>
        )}

        {mode === "realtime" && <RealtimeChat showDashboard />}
      </div>

      {mode !== "realtime" && (
        <form className="chat-input" onSubmit={(e) => e.preventDefault()}>
          <input type="text" placeholder="Escribe un mensaje..." disabled aria-disabled="true" />
          <button type="button" className="send-btn induction-btn subtle" disabled>Enviar</button>
        </form>
      )}
    </div>
  );
};

export default Chat;
