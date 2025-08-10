// src/Pestana/legal/Legal.tsx
import React, { useMemo, useState } from "react";
import {
  Rol,
  looksLikeIdentidad,
  buscarPorIdentidadSmart as buscarPorIdentidad,
  consultaConKpiSmart as consultaConKpi,
  CausaResumen,
  ConsultaMaybeKpiResponse,
  analizarMulta
} from "./LegalLogic";

type Props = {
  onUseInScoring: (partial: { procesosPenales: number; procesosLaborales: number }) => void;
};

type Relevance = {
  relevant: boolean;
  reason: string;
  partial: { procesosPenales: number; procesosLaborales: number };
};

/* ===== Gate de relevancia (solo PENAL/LABORAL y sólo si es DEMANDADO) ===== */
function assessForScoring(det: ConsultaMaybeKpiResponse): Relevance {
  const mat = (det.general?.materia || "").toUpperCase();
  const tipo = (det.general?.tipoaccion || "").toUpperCase();

  // Siempre evaluamos como DEMANDADO
  const isPenal = /PENAL/.test(mat) || /PENAL/.test(tipo);
  const isLaboral = /LABORAL/.test(mat) || /TRABAJO/.test(mat);

  if (isPenal) {
    return { relevant: true, reason: "Materia penal (Demandado).", partial: { procesosPenales: 1, procesosLaborales: 0 } };
  }
  if (isLaboral) {
    return { relevant: true, reason: "Materia laboral (Demandado).", partial: { procesosPenales: 0, procesosLaborales: 1 } };
  }

  // Multas/Tránsito, coactiva, contencioso no manchan scoring
  const multa = analizarMulta(det);
  if (multa.isMultaLike) {
    return { relevant: false, reason: "Multa/contravención. No afecta scoring.", partial: { procesosPenales: 0, procesosLaborales: 0 } };
  }

  return { relevant: false, reason: "Materia civil/otra sin penal/laboral. No se usa en scoring.", partial: { procesosPenales: 0, procesosLaborales: 0 } };
}

const Legal: React.FC<Props> = ({ onUseInScoring }) => {
  const [texto, setTexto] = useState("");
  // Rol fijo: DEMANDADO
  const rolFijo: Rol = "demandado";
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [resultados, setResultados] = useState<(CausaResumen & { rol?: Rol })[]>([]);
  const [status, setStatus] = useState<string>("");

  // cache de detalles y relevancia por idJuicio
  const [detallesById, setDetallesById] = useState<Record<string, ConsultaMaybeKpiResponse | null>>({});
  const [relevById, setRelevById] = useState<Record<string, Relevance>>({});
  const [loadingDetalleId, setLoadingDetalleId] = useState<string | null>(null);

  const esIdentidad = useMemo(() => looksLikeIdentidad(texto.trim()), [texto]);

  async function handleBuscar(e?: React.FormEvent) {
    e?.preventDefault();
    setError(null);
    setStatus("");
    setResultados([]);
    if (!texto.trim()) {
      setError("Escribe algo decente: cédula/RUC/pasaporte o Nº de causa/idJuicio.");
      return;
    }
    setLoading(true);
    try {
      if (esIdentidad) {
        const res = await buscarPorIdentidad(texto.trim(), rolFijo, 1, 10);
        const items = (res.items || []).map(it => ({ ...it, rol: rolFijo }));
        setResultados(items);
        if (!items.length) setStatus("Sin resultados para esa identificación.");
      } else {
        // Directo a detalle + KPI + gate
        const det = await consultaConKpi(texto.trim(), rolFijo, true);
        const rel = assessForScoring(det);
        setDetallesById(prev => ({ ...prev, [det.idCaso]: det }));
        setRelevById(prev => ({ ...prev, [det.idCaso]: rel }));

        // Tarjeta inline; guardamos el rol fijo
        setResultados([{
          idJuicio: det.idCaso,
          numeroCausa: det.general?.caso || det.idCaso,
          nombreMateria: det.general?.materia || "",
          nombreJudicatura: det.general?.judicatura || "",
          fechaIngreso: det.general?.fecha || "",
          rol: rolFijo
        }]);

        if (rel.relevant) {
          onUseInScoring(rel.partial);
          setStatus(`idJuicio ${det.idCaso} aplicado al scoring. (${rel.reason})`);
        } else {
          setStatus(`No se aplica al scoring: ${rel.reason}`);
        }
      }
    } catch (err: any) {
      setError(err?.message || "Error consultando servicio judicial.");
    } finally {
      setLoading(false);
    }
  }

  async function verDetalle(idJuicio: string) {
    if (detallesById[idJuicio]) return;
    setLoadingDetalleId(idJuicio);
    setError(null);
    try {
      const det = await consultaConKpi(idJuicio, rolFijo, true);
      const rel = assessForScoring(det);
      setDetallesById(prev => ({ ...prev, [idJuicio]: det }));
      setRelevById(prev => ({ ...prev, [idJuicio]: rel }));
      // Reflejar rol fijo en el array de resultados si existe el ítem
      setResultados(prev =>
        prev.map(it => it.idJuicio === idJuicio ? { ...it, rol: rolFijo } : it)
      );
    } catch (err: any) {
      setError(err?.message || "Error trayendo detalle de la causa.");
    } finally {
      setLoadingDetalleId(null);
    }
  }

  function usarEnScoring(idJuicio: string) {
    const rel = relevById[idJuicio];
    if (!rel) return;
    if (!rel.relevant) {
      setStatus(`No se aplica al scoring: ${rel.reason}`);
      return;
    }
    onUseInScoring(rel.partial);
    setStatus(`idJuicio ${idJuicio} aplicado al scoring. (${rel.reason})`);
  }

  return (
    <div className="kpi-upload-body" style={{ display: "grid", gap: 8 }}>
      {/* Búsqueda individual */}
      <form onSubmit={handleBuscar} style={{ display: "grid", gap: 6 }}>
        <label>Identificación o Nº de causa/idJuicio</label>
        <input
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Ej: 1308218997, 17156201501383G, 12345-2024-01234"
        />
        <small style={{ color: "#555" }}>
          Se consultará únicamente como <b>Demandado / Procesado</b>.
        </small>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="submit" className="send-btn">Buscar</button>
          {loading && <span style={{ fontSize: 12, opacity: 0.8 }}>Consultando…</span>}
        </div>
      </form>

      {error && (
        <div className="card tone-chat" style={{ padding: 8, borderColor: "#b91c1c", color: "#b91c1c" }}>
          {error}
        </div>
      )}
      {status && (
        <div className="card tone-chat" style={{ padding: 8 }}>
          {status}
        </div>
      )}

      {/* Resultados individuales */}
      {!!resultados.length && (
        <div className="card tone-chat">
          <div className="kpi-section-head"><h4>Resultados</h4></div>
          <div style={{ display: "grid", gap: 8 }}>
            {resultados.map((it) => {
              const det = detallesById[it.idJuicio] || null;
              const rel = relevById[it.idJuicio];
              return (
                <div key={it.idJuicio} className="kpi-card" style={{ padding: 10 }}>
                  <div style={{ fontWeight: 600 }}>
                    {it.numeroCausa || it.idJuicio}
                  </div>
                  <div style={{ fontSize: 13, opacity: 0.9 }}>
                    {it.nombreMateria || "—"} · {it.nombreJudicatura || "—"} · Rol: demandado
                  </div>
                  <div style={{ fontSize: 12, opacity: 0.75 }}>
                    {it.fechaIngreso ? new Date(it.fechaIngreso).toLocaleString() : ""}
                  </div>

                  {!det && (
                    <div style={{ marginTop: 6, display: "flex", gap: 8, alignItems: "center" }}>
                      <button
                        type="button"
                        className="send-btn subtle"
                        onClick={() => verDetalle(it.idJuicio)}
                        disabled={loadingDetalleId === it.idJuicio}
                      >
                        {loadingDetalleId === it.idJuicio ? "Cargando…" : "Ver detalle"}
                      </button>
                    </div>
                  )}

                  {det && (
                    <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
                      <div><b>Materia:</b> {det.general?.materia || "—"}</div>
                      <div><b>Tipo acción:</b> {det.general?.tipoaccion || "—"}</div>
                      <div><b>Delito:</b> {det.general?.delito || "—"}</div>
                      <div><b>Judicatura:</b> {det.general?.judicatura || "—"}</div>

                      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6 }}>
                        <span
                          style={{
                            padding: "2px 8px",
                            borderRadius: 999,
                            fontSize: 12,
                            fontWeight: 600,
                            background: rel?.relevant ? "rgba(0,160,80,.15)" : "rgba(210,50,50,.15)",
                            color: rel?.relevant ? "#0b8a47" : "#b91c1c",
                            border: `1px solid ${rel?.relevant ? "rgba(0,160,80,.35)" : "rgba(210,50,50,.35)"}`
                          }}
                        >
                          {rel?.relevant ? "Relevante para scoring" : "No relevante para scoring"}
                        </span>
                        <small style={{ opacity: .8 }}>{rel?.reason || "—"}</small>
                      </div>

                      <div style={{ marginTop: 6 }}>
                        <button
                          type="button"
                          className="send-btn"
                          disabled={!rel?.relevant}
                          onClick={() => usarEnScoring(it.idJuicio)}
                          title={rel?.relevant ? "Aplicar al scoring" : "No se aplica por política (ver motivo)"}
                        >
                          Usar en scoring
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default Legal;
