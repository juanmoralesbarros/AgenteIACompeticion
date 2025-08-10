// src/Chat.tsx (fusionado, sin perder funcionalidades de ninguno)
import React, { useEffect, useRef, useState } from "react";
import "./Chat.css";

// Bloque KPI + SRI
import { useKpiScoringV2 } from "../hooks/useKpiScoringDemo";
import Legal from "./legal/Legal";
import LegalNomina from "./legal/LegalNomina";
import { looksLikeRuc, sriExists, sriContribuyente, toPartialFromSRI } from "./legal/sriLogic";

// Bloque tiempo real
import { ChatWebSocket } from "../services/utilesChat";
import Dashboard from "./Dashboard";

const SHOW_DASHBOARD = true; // true => muestra el Dashboard en el modo "realtime"

const Chip: React.FC<{ onClick?: () => void; children: React.ReactNode }> = ({ onClick, children }) => (
  <span className="chip" onClick={onClick} role="button" tabIndex={0}>{children}</span>
);

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
const fmtUSD = (x: number) =>
  new Intl.NumberFormat("es-EC", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(x);
const pct = (x: number, digits = 0) => `${x.toFixed(digits)}%`;

function badgeStyle(kind: "ok" | "warn" | "bad") {
  const base: React.CSSProperties = { padding: "2px 8px", borderRadius: 999, fontSize: 12, fontWeight: 600 };
  if (kind === "ok") return { ...base, background: "rgba(0,160,80,.15)", color: "#0b8a47", border: "1px solid rgba(0,160,80,.35)" };
  if (kind === "warn") return { ...base, background: "rgba(230,165,0,.15)", color: "#c07a00", border: "1px solid rgba(230,165,0,.35)" };
  return { ...base, background: "rgba(210,50,50,.15)", color: "#b82222", border: "1px solid rgba(210,50,50,.35)" };
}

interface Message {
  sender: "user" | "bot";
  text: string;
}

const Chat: React.FC = () => {
  // Selector de modo
  const [mode, setMode] = useState<"landing" | "kpi" | "realtime">("landing");

  // Estado KPI + SRI
  const [ruc, setRuc] = useState("");
  const {
    loaded, simulate, grupos, derivados, scoreGlobal, decision, montos, cobertura, gates, pd,
    applyLegalPartial
  } = useKpiScoringV2();

  const [sriLoading, setSriLoading] = useState(false);
  const [sriMsg, setSriMsg] = useState<string>("");
  const [sriErr, setSriErr] = useState<string>("");
  const [sriData, setSriData] = useState<any | null>(null);

  useEffect(() => {
    if (mode === "kpi" && !loaded) simulate(ruc);
  }, [mode, loaded, ruc, simulate]);

  async function handleValidarRuc() {
    setSriErr("");
    setSriMsg("");
    setSriData(null);
    const r = ruc.trim();
    if (!looksLikeRuc(r)) {
      setSriErr("RUC inválido. Debe tener 13 dígitos.");
      return;
    }
    setSriLoading(true);
    try {
      const exists = await sriExists(r);
      if (!exists) {
        setSriMsg("El RUC no existe en SRI.");
        return;
      }
      const det = await sriContribuyente(r);
      if (!det.existe || !det.data) {
        setSriMsg("El RUC existe pero SRI no devolvió datos útiles.");
        return;
      }
      setSriData(det.data);
      const partial = toPartialFromSRI(det);
      applyLegalPartial(partial);
      const fecha = partial.fechaInicioActividades || "—";
      setSriMsg(`RUC válido: ${det.data.razonSocial || det.ruc}. Fecha inicio: ${fecha}. Aplicado a KPIs.`);
    } catch (e: any) {
      setSriErr(e?.message || "Error consultando SRI.");
    } finally {
      setSriLoading(false);
    }
  }

  const gateBadges = [
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

  const decisionKind: "ok" | "warn" | "bad" =
    decision === "APROBADO" ? "ok" :
    decision === "APROBADO CONDICIONES" || decision === "REVISION" ? "warn" : "bad";

  // Estado chat tiempo real
  const [connected, setConnected] = useState(false);
  const [started, setStarted] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");

  const wsRef = useRef<ChatWebSocket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Solo inicia WS una vez, útil para el modo "realtime"
    const ws = new ChatWebSocket(
      "ws://localhost:8000/api/v1/ws",
      (msg) => {
        if (typeof msg === "string") {
          setMessages((prev) => [...prev, { sender: "bot", text: msg }]);
        } else if (msg?.message) {
          setMessages((prev) => [...prev, { sender: "bot", text: msg.message }]);
        }
      },
      () => setConnected(true)
    );
    ws.connect();
    wsRef.current = ws;
    // No cierro aquí para respetar el comportamiento del original
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = () => {
    if (!input.trim()) return;
    if (!started) setStarted(true);
    setMessages((prev) => [...prev, { sender: "user", text: input }]);
    wsRef.current?.send(input);
    setInput("");
  };

  const handleChipClick = (text: string) => {
    setInput(text);
  };

  return (
    <div className="card tone-chat card-chat">
      <header className="chat-header">
        <h2>Chatbot</h2>
        <p>Interactúa con tu asistente</p>

        {/* Selector simple de modo para conservar ambos mundos */}
        <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
          <button type="button" className={`send-btn subtle ${mode === "landing" ? "active" : ""}`} onClick={() => setMode("landing")}>Landing</button>
          <button type="button" className={`send-btn subtle ${mode === "kpi" ? "active" : ""}`} onClick={() => setMode("kpi")}>Scoring (KPI)</button>
          <button type="button" className={`send-btn subtle ${mode === "realtime" ? "active" : ""}`} onClick={() => setMode("realtime")}>Chat tiempo real</button>
        </div>
      </header>

      <div className="chat-body">
        {mode === "landing" && (
          <div className="chat-landing in-body">
            <div className="chat-landing-inner">
              <div className="chat-logo">◎</div>
              <h3>Bienvenido a AgenteIA</h3>
              <p className="hint">
                Conecta una red social o carga un archivo para empezar.<br />
                También puedes preguntarme cómo preparar tus datos.
              </p>
              <div className="quick-examples">
                {/* Conserva chips de ambos archivos */}
                <Chip>¿Qué formatos de archivo aceptas?</Chip>
                <Chip>¿Cómo conecto mi cuenta de Instagram?</Chip>
                <Chip onClick={() => setMode("kpi")}>Muestra un ejemplo de scoring</Chip>
                <Chip onClick={() => setMode("realtime")}>Abrir chat en tiempo real</Chip>
              </div>
            </div>
          </div>
        )}

        {mode === "kpi" && (
          <div className="chat-kpi-wrap">
            {/* Panel judicial individual original (mantener como comentario, no eliminado) */}
            {/*
            <div className="card tone-chat" style={{ marginBottom: 12 }}>
              <div className="card-header">
                <h3>Consulta Judicial</h3><span className="badge">API</span>
              </div>
              <Legal onUseInScoring={(partial) => applyLegalPartial(partial)} />
            </div>
            */}

            {/* Panel judicial de Nómina (batch) */}
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

            {/* Demo + SRI */}
            <div className="card tone-chat" style={{ marginBottom: 12 }}>
              <div className="card-header">
                <h3>Demo de Scoring</h3><span className="badge">Mock + SRI</span>
              </div>
              <div className="kpi-upload-body" style={{ display: "grid", gap: 8 }}>
                <label>RUC</label>
                <div style={{ display: "flex", gap: 8 }}>
                  <input value={ruc} onChange={(e) => setRuc(e.target.value)} placeholder="Ingresa RUC (13 dígitos)" />
                  <button type="button" className="send-btn subtle" onClick={handleValidarRuc} disabled={sriLoading}>
                    {sriLoading ? "Validando…" : "Validar en SRI"}
                  </button>
                </div>
                {sriErr && <small style={{ color: "#b82222" }}>{sriErr}</small>}
                {sriMsg && <small style={{ color: "#0b8a47" }}>{sriMsg}</small>}
                <small>Se usan datos quemados del hook. SRI alimenta antigüedad/estado/formalidad para KPIs.</small>
              </div>

              {sriData && (
                <div className="card tone-chat" style={{ marginTop: 10 }}>
                  <div className="kpi-section-head"><h4>Consulta de RUC</h4></div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px,1fr))", gap: 10 }}>
                    <div><b>RUC</b><br />{sriData.numeroRuc || "—"}</div>
                    <div><b>Razón social</b><br />{sriData.razonSocial || "—"}</div>
                    <div><b>Estado contribuyente en el RUC</b><br />{sriData.estadoContribuyenteRuc || "—"}</div>
                    <div style={{ gridColumn: "1 / -1" }}>
                      <b>Actividad económica principal</b><br />{sriData.actividadEconomicaPrincipal || "—"}
                    </div>
                    <div><b>Tipo contribuyente</b><br />{sriData.tipoContribuyente || "—"}</div>
                    <div><b>Régimen</b><br />{sriData.regimen || "—"}</div>
                    <div><b>Obligado a llevar contabilidad</b><br />{sriData.obligadoLlevarContabilidad || "—"}</div>
                    <div><b>Agente de retención</b><br />{sriData.agenteRetencion || "—"}</div>
                    <div><b>Contribuyente especial</b><br />{sriData.contribuyenteEspecial || "—"}</div>
                    <div><b>Contribuyente fantasma</b><br />{sriData.contribuyenteFantasma || "—"}</div>
                    <div><b>Transacciones inexistentes</b><br />{sriData.transaccionesInexistente || "—"}</div>
                    <div><b>Fecha inicio actividades</b><br />{sriData.fechaInicioISO || sriData?.informacionFechasContribuyente?.fechaInicioActividades || "—"}</div>
                    <div><b>Fecha actualización</b><br />{sriData?.informacionFechasContribuyente?.fechaActualizacion || "—"}</div>
                    <div><b>Fecha cese actividades</b><br />{sriData?.informacionFechasContribuyente?.fechaCese || "—"}</div>
                    <div><b>Fecha reinicio actividades</b><br />{sriData?.informacionFechasContribuyente?.fechaReinicioActividades || "—"}</div>
                  </div>
                </div>
              )}
            </div>

            {!loaded && (
              <div className="card tone-chat" style={{ padding: 20, opacity: .85 }}>
                Cargando demo… preparando KPIs con JSON mock.
              </div>
            )}

            {loaded && (
              <>
                {/* Resumen */}
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

                {/* Gates */}
                <div className="card tone-chat" style={{ padding: 14 }}>
                  <div className="kpi-section-head" style={{ marginBottom: 8 }}>
                    <h4 style={{ margin: 0 }}>Políticas (gates)</h4>
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

                {/* KPIs por grupo */}
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
        )}

        {mode === "realtime" && (
          <>
            {SHOW_DASHBOARD ? (
              <Dashboard />
            ) : !started ? (
              <div className="chat-landing in-body">
                <div className="chat-landing-inner">
                  <div className="chat-logo">◎</div>
                  <h3>Bienvenido a AgenteIA</h3>
                  <p className="hint">
                    Conecta una red social o carga un archivo para empezar.<br />
                    También puedes preguntarme cómo preparar tus datos.
                  </p>
                  <div className="quick-examples">
                    <Chip onClick={() => handleChipClick("¿Qué formatos de archivo aceptas?")}>
                      ¿Qué formatos de archivo aceptas?
                    </Chip>
                    <Chip onClick={() => handleChipClick("¿Cómo conecto mi cuenta de Instagram?")}>
                      ¿Cómo conecto mi cuenta de Instagram?
                    </Chip>
                    <Chip onClick={() => handleChipClick("Muestra un ejemplo de scoring")}>
                      Muestra un ejemplo de scoring
                    </Chip>
                  </div>
                </div>
              </div>
            ) : (
              <div className="chat-messages">
                {messages.map((m, i) => (
                  <div key={i} className={`chat-message ${m.sender}`}>
                    {m.text}
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>
            )}
          </>
        )}
      </div>

      {/* Inputs: conserva el input deshabilitado del primer archivo y el activo del segundo */}
      {mode !== "realtime" && (
        <form className="chat-input" onSubmit={(e) => e.preventDefault()}>
          <input type="text" placeholder="Escribe un mensaje..." disabled aria-disabled="true" />
          <button type="button" className="send-btn induction-btn subtle" disabled>Enviar</button>
        </form>
      )}

      {mode === "realtime" && !SHOW_DASHBOARD && (
        <form className="chat-input" onSubmit={(e) => { e.preventDefault(); handleSend(); }}>
          <input
            type="text"
            placeholder={connected ? "Escribe un mensaje..." : "Conectando..."}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={!connected}
          />
          <button type="submit" className="send-btn induction-btn subtle" disabled={!connected}>Enviar</button>
        </form>
      )}
    </div>
  );
};

export default Chat;
