// src/Pestana/legal/SRI.tsx
import React, { useState } from "react";
import { looksLikeRuc, sriExists, sriContribuyente, toPartialFromSRI } from "./sriLogic";

type Props = {
  ruc: string;
  onChangeRuc: (value: string) => void;
  onApplyPartial: (partial: any) => void; // el hook de scoring sabe qué hacer con esto
};

const SRI: React.FC<Props> = ({ ruc, onChangeRuc, onApplyPartial }) => {
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string>("");
  const [err, setErr] = useState<string>("");
  const [data, setData] = useState<any | null>(null);

  async function handleValidarRuc() {
    setErr("");
    setMsg("");
    setData(null);
    const value = (ruc || "").trim();
    if (!looksLikeRuc(value)) {
      setErr("RUC inválido. Debe tener 13 dígitos.");
      return;
    }
    setLoading(true);
    try {
      const exists = await sriExists(value);
      if (!exists) {
        setMsg("El RUC no existe en SRI.");
        return;
      }
      const det = await sriContribuyente(value);
      if (!det.existe || !det.data) {
        setMsg("El RUC existe pero SRI no devolvió datos útiles.");
        return;
      }
      setData(det.data);
      const partial = toPartialFromSRI(det);
      onApplyPartial(partial);
      const fecha = partial.fechaInicioActividades || "—";
      setMsg(`RUC válido: ${det.data.razonSocial || det.ruc}. Fecha inicio: ${fecha}. Aplicado a KPIs.`);
    } catch (e: any) {
      setErr(e?.message || "Error consultando SRI.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div className="kpi-upload-body" style={{ display: "grid", gap: 8 }}>
        <label>RUC</label>
        <div style={{ display: "flex", gap: 8 }}>
          <input value={ruc} onChange={(e) => onChangeRuc(e.target.value)} placeholder="Ingresa RUC (13 dígitos)" />
          <button type="button" className="send-btn subtle" onClick={handleValidarRuc} disabled={loading}>
            {loading ? "Validando…" : "Validar en SRI"}
          </button>
        </div>
        {err && <small style={{ color: "#b82222" }}>{err}</small>}
        {msg && <small style={{ color: "#0b8a47" }}>{msg}</small>}
        <small>Se usan datos quemados del hook. SRI alimenta antigüedad/estado/formalidad para KPIs.</small>
      </div>

      {data && (
        <div className="card tone-chat" style={{ marginTop: 10 }}>
          <div className="kpi-section-head"><h4>Consulta de RUC</h4></div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px,1fr))", gap: 10 }}>
            <div><b>RUC</b><br />{data.numeroRuc || "—"}</div>
            <div><b>Razón social</b><br />{data.razonSocial || "—"}</div>
            <div><b>Estado contribuyente en el RUC</b><br />{data.estadoContribuyenteRuc || "—"}</div>
            <div style={{ gridColumn: "1 / -1" }}>
              <b>Actividad económica principal</b><br />{data.actividadEconomicaPrincipal || "—"}
            </div>
            <div><b>Tipo contribuyente</b><br />{data.tipoContribuyente || "—"}</div>
            <div><b>Régimen</b><br />{data.regimen || "—"}</div>
            <div><b>Obligado a llevar contabilidad</b><br />{data.obligadoLlevarContabilidad || "—"}</div>
            <div><b>Agente de retención</b><br />{data.agenteRetencion || "—"}</div>
            <div><b>Contribuyente especial</b><br />{data.contribuyenteEspecial || "—"}</div>
            <div><b>Contribuyente fantasma</b><br />{data.contribuyenteFantasma || "—"}</div>
            <div><b>Transacciones inexistentes</b><br />{data.transaccionesInexistente || "—"}</div>
            <div><b>Fecha inicio actividades</b><br />{data.fechaInicioISO || data?.informacionFechasContribuyente?.fechaInicioActividades || "—"}</div>
            <div><b>Fecha actualización</b><br />{data?.informacionFechasContribuyente?.fechaActualizacion || "—"}</div>
            <div><b>Fecha cese actividades</b><br />{data?.informacionFechasContribuyente?.fechaCese || "—"}</div>
            <div><b>Fecha reinicio actividades</b><br />{data?.informacionFechasContribuyente?.fechaReinicioActividades || "—"}</div>
          </div>
        </div>
      )}
    </>
  );
};

export default SRI;
