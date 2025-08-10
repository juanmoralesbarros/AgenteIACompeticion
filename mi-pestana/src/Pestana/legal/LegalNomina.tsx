// src/Pestana/legal/LegalNomina.tsx
import React, { useMemo, useState } from "react";
import {
  aggregateNominaToPartial,
  NominaResponse,
  nominaResumenSmart,
  RepresentanteNominaIn,
  consultaConKpiSmart as consultaConKpi,
  analizarMulta,
  ConsultaMaybeKpiResponse,
} from "./LegalLogic";

type NominaProps = {
  onUseInScoring: (partial: { procesosPenales: number; procesosLaborales: number }) => void;
  defaultEmpresaRuc?: string;
  defaultRepresentantes?: RepresentanteNominaIn[];
  onResults?: (resp: NominaResponse) => void;
  showInlineResults?: boolean; // default: true
};

type Relevance = {
  relevant: boolean;
  reason: string;
  partial: { procesosPenales: number; procesosLaborales: number };
};

/* ===== Gate de relevancia (PENAL/LABORAL como DEMANDADO) ===== */
function assessForScoring(det: ConsultaMaybeKpiResponse): Relevance {
  const mat = (det.general?.materia || "").toUpperCase();
  const tipo = (det.general?.tipoaccion || "").toUpperCase();

  const isPenal = /PENAL/.test(mat) || /PENAL/.test(tipo);
  const isLaboral = /LABORAL/.test(mat) || /TRABAJO/.test(mat);

  if (isPenal) {
    return { relevant: true, reason: "Materia penal (Demandado).", partial: { procesosPenales: 1, procesosLaborales: 0 } };
  }
  if (isLaboral) {
    return { relevant: true, reason: "Materia laboral (Demandado).", partial: { procesosPenales: 0, procesosLaborales: 1 } };
  }

  const multa = analizarMulta(det);
  if (multa.isMultaLike) {
    return { relevant: false, reason: "Multa/contravención. No afecta scoring.", partial: { procesosPenales: 0, procesosLaborales: 0 } };
  }

  return { relevant: false, reason: "Materia civil/otra sin penal/laboral. No se usa en scoring.", partial: { procesosPenales: 0, procesosLaborales: 0 } };
}

const LegalNomina: React.FC<NominaProps> = ({
  onUseInScoring,
  defaultEmpresaRuc = "",
  defaultRepresentantes = [],
  onResults,
  showInlineResults = true
}) => {
  const [empresaRuc, setEmpresaRuc] = useState(defaultEmpresaRuc);
  const [rows, setRows] = useState<RepresentanteNominaIn[]>(defaultRepresentantes);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resp, setResp] = useState<NominaResponse | null>(null);
  const [status, setStatus] = useState("");

  // cache de detalles y relevancia por idJuicio
  const [detallesById, setDetallesById] = useState<Record<string, ConsultaMaybeKpiResponse | null>>({});
  const [relevById, setRelevById] = useState<Record<string, Relevance>>({});
  const [loadingDetalleId, setLoadingDetalleId] = useState<string | null>(null);

  function addRow() {
    setRows((r) => [...r, { identificacion: "", tipo: undefined, nombre: "", cargo: "", tipoRepresentacion: "" }]);
  }
  function updateRow(i: number, patch: Partial<RepresentanteNominaIn>) {
    setRows((r) => r.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  }
  function removeRow(i: number) {
    setRows((r) => r.filter((_, idx) => idx !== i));
  }

  const canSend = useMemo(
    () => empresaRuc.trim().length === 13 && rows.every((r) => (r.identificacion || "").trim().length >= 10),
    [empresaRuc, rows]
  );

  async function handleRun() {
    setError(null);
    setStatus("");
    setResp(null);
    if (!canSend) {
      setError("Completa el RUC de la empresa (13 dígitos) y al menos una identificación válida.");
      return;
    }
    setLoading(true);
    try {
      const out = await nominaResumenSmart({
        empresa_ruc: empresaRuc.trim(),
        representantes: rows.map((r) => ({
          identificacion: r.identificacion.trim(),
          tipo: r.tipo,
          nombre: r.nombre,
          cargo: r.cargo,
          tipoRepresentacion: r.tipoRepresentacion,
        })),
        // Solo DEMANDADO
        roles: ["demandado"],
        incluir_kpi: true,
      });

      setResp(out);
      onResults?.(out);

      const partial = aggregateNominaToPartial(out);
      onUseInScoring({
        procesosPenales: partial.procesosPenales ?? 0,
        procesosLaborales: partial.procesosLaborales ?? 0
      });

      setStatus(
        `Aplicado al scoring: penal=${partial.procesosPenales ?? 0} laboral=${partial.procesosLaborales ?? 0}. ` +
        `Empresa causas=${out.empresa.total_causas}, reps=${out.representantes.reduce((s, x) => s + x.total_causas, 0)}`
      );
    } catch (e: any) {
      setError(e?.message || "Error consultando nómina judicial.");
    } finally {
      setLoading(false);
    }
  }

  async function verDetalle(idJuicio: string) {
    if (detallesById[idJuicio]) return;
    setLoadingDetalleId(idJuicio);
    setError(null);
    try {
      // Consulta fija como DEMANDADO
      const det = await consultaConKpi(idJuicio, "demandado", true);
      const rel = assessForScoring(det);
      setDetallesById(prev => ({ ...prev, [idJuicio]: det }));
      setRelevById(prev => ({ ...prev, [idJuicio]: rel }));
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
      <div className="card tone-chat" style={{ padding: 8 }}>
        <h4 style={{ margin: 0 }}>Nómina de administradores: consulta judicial (Demandado)</h4>
      </div>

      <div className="card tone-chat" style={{ padding: 8, display: "grid", gap: 8 }}>
        <label>RUC de la empresa</label>
        <input value={empresaRuc} onChange={(e) => setEmpresaRuc(e.target.value)} placeholder="1792921392001" />
        <small style={{ color: "#555" }}>
          Todas las consultas se harán únicamente como <b>Demandado / Procesado</b>.
        </small>
      </div>

      <div className="card tone-chat" style={{ padding: 8 }}>
        <div className="kpi-section-head" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h4 style={{ margin: 0 }}>Representantes</h4>
          <button type="button" className="send-btn subtle" onClick={addRow}>Agregar fila</button>
        </div>
        <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
          {rows.map((r, i) => (
            <div key={i} className="kpi-card" style={{ padding: 8, display: "grid", gap: 6 }}>
              <div style={{ display: "grid", gap: 6, gridTemplateColumns: "1fr 120px 1fr 1fr 100px" }}>
                <input value={r.identificacion || ""} onChange={(e) => updateRow(i, { identificacion: e.target.value })} placeholder="Cédula/RUC" />
                <select value={r.tipo || ""} onChange={(e) => updateRow(i, { tipo: (e.target.value || undefined) as any })}>
                  <option value="">Tipo</option>
                  <option value="CEDULA">CÉDULA</option>
                  <option value="RUC">RUC</option>
                  <option value="PASAPORTE">PASAPORTE</option>
                </select>
                <input value={r.nombre || ""} onChange={(e) => updateRow(i, { nombre: e.target.value })} placeholder="Nombre" />
                <input value={r.cargo || ""} onChange={(e) => updateRow(i, { cargo: e.target.value })} placeholder="Cargo" />
                <input value={r.tipoRepresentacion || ""} onChange={(e) => updateRow(i, { tipoRepresentacion: e.target.value })} placeholder="Tipo rep." />
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button type="button" className="send-btn subtle" onClick={() => removeRow(i)}>Quitar</button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button type="button" className="send-btn" onClick={handleRun} disabled={loading || !canSend}>
          {loading ? "Consultando…" : "Consultar nómina y aplicar al scoring"}
        </button>
        {!canSend && <small style={{ color: "#b91c1c" }}>RUC (13) e identificaciones válidas requeridos.</small>}
      </div>

      {error && <div className="card tone-chat" style={{ padding: 8, borderColor: "#b91c1c", color: "#b91c1c" }}>{error}</div>}
      {status && <div className="card tone-chat" style={{ padding: 8 }}>{status}</div>}

      {showInlineResults && resp && (
        <div className="card tone-chat">
          <div className="kpi-section-head"><h4>Resultados</h4></div>
          <div style={{ display: "grid", gap: 8 }}>

            {/* Empresa: cabecera */}
            <div className="kpi-card" style={{ padding: 10 }}>
              <div style={{ fontWeight: 600 }}>
                {resp.empresa.identificacion}
                {resp.empresa.nombre ? ` · ${resp.empresa.nombre}` : ""}
              </div>
              <div style={{ fontSize: 13, opacity: 0.9 }}>
                Empresa · Penal: {resp.empresa.kpi?.penal ?? 0} · Laboral: {resp.empresa.kpi?.laboral ?? 0}
              </div>
              <div style={{ fontSize: 12, opacity: 0.75 }}>
                Total causas: {resp.empresa.total_causas}
              </div>
            </div>

            {/* Empresa: causas (todas Demandado) */}
            {(resp.empresa.items || []).map((it) => {
              const det = detallesById[it.idJuicio] || null;
              const rel = relevById[it.idJuicio];
              return (
                <div key={`emp-${it.idJuicio}`} className="kpi-card" style={{ padding: 10 }}>
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

            {/* Representantes: cabecera + causas (todas Demandado) */}
            {resp.representantes.map((r, idx) => (
              <React.Fragment key={`rep-${idx}`}>
                <div className="kpi-card" style={{ padding: 10 }}>
                  <div style={{ fontWeight: 600 }}>
                    {r.identificacion}{r.nombre ? ` · ${r.nombre}` : ""}
                  </div>
                  <div style={{ fontSize: 13, opacity: 0.9 }}>
                    {(r.cargo || "—")}{r.tipoRepresentacion ? ` · ${r.tipoRepresentacion}` : ""} · Penal: {r.kpi?.penal ?? 0} · Laboral: {r.kpi?.laboral ?? 0}
                  </div>
                  <div style={{ fontSize: 12, opacity: 0.75 }}>
                    Total causas: {r.total_causas}
                  </div>
                </div>

                {(r.items || []).map((it) => {
                  const det = detallesById[it.idJuicio] || null;
                  const rel = relevById[it.idJuicio];
                  return (
                    <div key={`rep-${r.identificacion}-${it.idJuicio}`} className="kpi-card" style={{ padding: 10 }}>
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
              </React.Fragment>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default LegalNomina;
export type { NominaResponse, RepresentanteNominaIn };
