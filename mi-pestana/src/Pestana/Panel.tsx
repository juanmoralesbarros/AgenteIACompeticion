import React, { useEffect, useMemo, useState } from "react";
import "./Panel.css";
import {
searchInstagramUsers,
InstagramSearchItem,
getInstagramInfo,
getSelectedInstagram,
saveSelectedInstagram,
SelectedInstagram,
connectInstagramCommentsStream,
} from "../services/utilesPanel";

type PanelProps = {
  onOpenUploader: () => void;
};

type ModalStep = "network" | "search";
type Network = "instagram" | null;

const Panel: React.FC<PanelProps> = ({ onOpenUploader }) => {
  // selección persistente
  const [selectedAccount, setSelectedAccount] = useState<SelectedInstagram | null>(null);

  // modal
  const [showSocialModal, setShowSocialModal] = useState(false);
  const [modalStep, setModalStep] = useState<ModalStep>("network");
  const [selectedNetwork, setSelectedNetwork] = useState<Network>(null);

  // búsqueda
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<InstagramSearchItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  // info limpia
  const [loadingInfo, setLoadingInfo] = useState(false);

  // despliegue de stats (toggle con flecha)
  const [showStats, setShowStats] = useState(false);

  // junto al resto de useState(...)
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzed, setAnalyzed] = useState(false);
  const [streamCtrl, setStreamCtrl] = useState<{ close: () => void } | null>(null);
  const [analysisResult, setAnalysisResult] = useState<any | null>(null);

  useEffect(() => {
  return () => { try { streamCtrl?.close(); } catch {} };
}, [streamCtrl]);

  const startAnalyze = () => {
  if (!selectedAccount || analyzing || analyzed) return;

  setAnalyzing(true);
  setAnalyzed(false);
  setAnalysisResult(null);

  const ctrl = connectInstagramCommentsStream(
    {
      usernameOrId: selectedAccount.id || selectedAccount.username,
      maxPosts: 20,            // ajusta si quieres
      maxRequests: 2,
      maxCommentsPerPost: 20,
      sortBy: "popular",
    },
    {
      onStarted: () => { /* opcional: set algún texto de estado */ },
      onProgress: () => { /* opcional: barra de progreso */ },
      onDone: (done) => {
        console.log("✅ WebSocket finalizado");
        console.log("📥 Comentarios recibidos:", done.comments);

        setAnalyzing(false);
        setAnalyzed(true);
        setAnalysisResult(done);
        setStreamCtrl(null);
      },
      onError: (e) => {
        console.error(e);
        setAnalyzing(false);
        setAnalyzed(false);
        setStreamCtrl(null);
      },
      onClose: () => {
        // si se cerró sin done/error explícito
        setAnalyzing(false);
      },
    }
  );

    setStreamCtrl(ctrl);
  };



  // cargar selección guardada
  useEffect(() => {
    const saved = getSelectedInstagram();
    if (saved) setSelectedAccount(saved);
  }, []);

  // si no hay cuenta, asegúrate de ocultar stats
  useEffect(() => {
    if (!selectedAccount) setShowStats(false);
  }, [selectedAccount]);

  const canSearch = useMemo(() => query.trim().length >= 2, [query]);

  const openModal = () => {
    setShowSocialModal(true);
    setModalStep("network");
    setSelectedNetwork(null);
    setQuery("");
    setResults([]);
    setError(null);
  };

  const chooseNetwork = (net: Exclude<Network, null>) => {
    setSelectedNetwork(net);
    setModalStep("search");
  };

  const doSearch = async () => {
    if (!canSearch) return;
    try {
      setLoading(true);
      setError(null);
      const list = await searchInstagramUsers(query.trim());
      setResults(list);
    } catch (e: any) {
      setError(e?.message ?? "Error buscando usuarios");
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const chooseAccount = async (item: InstagramSearchItem) => {
    const idOrUsername = item.id || item.username;
    try {
      setLoadingInfo(true);
      const info = await getInstagramInfo(idOrUsername);

      const sel: SelectedInstagram = {
        platform: "instagram",
        id: info.id || item.id || item.username,
        username: info.username || item.username,
        fullName: (info.full_name ?? item.full_name) ?? null,
        profilePicUrl: info.profile_pic_url ?? item.profile_pic_url ?? null,
        isVerified: (info.is_verified ?? item.is_verified) ?? false,
        followers: info.followers_count ?? null,
        following: info.following_count ?? null,
        posts: info.media_count ?? null,
      };

      saveSelectedInstagram(sel);
      setSelectedAccount(sel);
      setShowSocialModal(false);
      setShowStats(false); // queda colapsado hasta que toques la flecha


      setAnalyzing(false);     // ⬅️ reset
      setAnalyzed(false);      // ⬅️ reset
      setAnalysisResult(null); // ⬅️ reset
    } catch (e: any) {
      setError(e?.message ?? "No se pudo obtener la información de la cuenta");
    } finally {
      setLoadingInfo(false);
    }
  };

  const toggleStats = (e: React.MouseEvent) => {
    if (!selectedAccount) return; // solo si ya hay cuenta
    e.stopPropagation(); // no abrir el modal
    setShowStats((v) => !v);
  };

  return (
    <>
      <header className="card-header">
        <svg className="ia-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path
             d="M9 3v2H7a2 2 0 0 0-2 2v2H3v2h2v2H3v2h2v2a2 2 0 0 0 2 2h2v2h2v-2h2v2h2v-2h2a2 2 0 0 0 2-2v-2h2v-2h-2v-2h2V9h-2V7a2 2 0 0 0-2-2h-2V3h-2v2h-2V3H9Zm8 6v6a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1Z"
            fill="currentColor"
          />
        </svg>
        <div>
          <h1>Panel</h1>
          <p>Acciones rápidas para comenzar</p>
        </div>
      </header>

      {/* Acciones */}
      <div className="panel-actions">
        {/* Red social */}
        <button
          className="induction-btn subtle social-btn"
          onClick={openModal}                 // abre el selector (paso red -> búsqueda)
          type="button"
        >
          <span className="led-dot" />
          <span className="btn-label">
            {selectedAccount ? (
              <>Instagram · <strong>@{selectedAccount.username}</strong></>
            ) : <>Red social</>}
          </span>

          {/* Flecha: toggle de stats solo si ya hay cuenta */}
            <span
              className={`btn-right arrow ${selectedAccount && showStats ? "open" : ""}`}
              onClick={(e) => {
                if (selectedAccount) {
                  // Solo bloquea el click del botón cuando ya hay cuenta
                  e.stopPropagation();
                  setShowStats(v => !v);
                }
                // Si NO hay cuenta, no hacemos stopPropagation:
                // el click llegará al botón y abrirá el modal (openModal)
              }}
              aria-label="Mostrar/ocultar detalles"
              title="Mostrar/ocultar detalles"
            >
              ▾
            </span>
        </button>

        {/* Stats SOLO si hay selección y si el usuario abrió con la flecha */}
        {selectedAccount && showStats && (
          <section className="social-stats">
            <header className="stats-head">
              <div className="avatar">@</div>
              <div>
                <div className="user">
                  @{selectedAccount.username} {selectedAccount.isVerified && "✔"}
                </div>
                <div className="name">
                  {selectedAccount.fullName || "Cuenta de Instagram"}
                </div>
              </div>
            </header>
            <div className="stats-grid">
              <div className="stat">
                <span className="stat-num">
                  {selectedAccount.followers ?? "—"}
                </span>
                <span className="stat-label">Seguidores</span>
              </div>
              <div className="stat">
                <span className="stat-num">
                  {selectedAccount.following ?? "—"}
                </span>
                <span className="stat-label">Siguiendo</span>
              </div>
              <div className="stat">
                <span className="stat-num">
                  {selectedAccount.posts ?? "—"}
                </span>
                <span className="stat-label">Publicaciones</span>
              </div>
            </div>
            {/* Botón de analizar cuenta */}
            <button
              className="induction-btn subtle"
              style={{ 
                    marginTop: "0.8rem",
                    width: "100%",
                    cursor: analyzing || analyzed ? "not-allowed" : "pointer",   // ⬅️ cursor
                    opacity: analyzing || analyzed ? 0.6 : 1,  
              }}
              onClick={startAnalyze}
              disabled={analyzing || analyzed} 
            >
              {analyzing ? (
                <>
                  <i className="fa-light fa-spinner fa-spin" style={{ marginRight: ".5rem" }} />
                  Analizando…
                </>
              ) : analyzed ? (
                <>
                  <i className="fa-light fa-check" style={{ marginRight: ".5rem" }} />
                  Cuenta analizada
                </>
              ) : (
                <>
                  <i className="fa-light fa-chart-line" style={{ marginRight: ".5rem" }} />
                  Analizar cuenta
                </>
              )}
            </button>

          </section>
        )}



        {/* Cargar datos */}
        <button
          className="induction-btn subtle social-btn"
          onClick={onOpenUploader}            // abre tu modal de arrastrar archivos
          type="button"
        >
          <span className="led-dot" />
          <span className="btn-label">Cargar datos</span>

          {/* Misma flecha y estilo que el de arriba (no hace toggle aquí) */}
          <span
            className="btn-right arrow"
            onClick={(e) => {
              e.stopPropagation();
              onOpenUploader();
            }}
            aria-label="Abrir cargador de archivos"
            title="Abrir cargador de archivos"
          >
            ▾
          </span>
        </button>
      </div>


      {/* Objetivo del Agente: se oculta si las stats están desplegadas */}
      {!(selectedAccount && showStats) && (
        <section className="panel-brief">
          <h3>Objetivo del Agente</h3>
          <p>
            Evaluar el <strong>riesgo financiero</strong> de PYMEs con señales alternativas
            y traducirlas en un <em>scoring</em> claro y justificable.
          </p>
        </section>
      )}

      {/* MODAL: Paso 1 -> elegir red. Paso 2 -> buscar cuenta */}
      {showSocialModal && (
        <div className="social-modal-overlay" onClick={() => setShowSocialModal(false)}>
          <div className="social-modal" onClick={(e) => e.stopPropagation()}>
            <header className="social-modal-head">
              <h3>{modalStep === "network" ? "Elige una red social" : "Conectar Instagram"}</h3>
              <button className="uploader-close" onClick={() => setShowSocialModal(false)}>✕</button>
            </header>

            {modalStep === "network" && (
              <div className="network-grid">
                <button className="network-tile instagram" onClick={() => chooseNetwork("instagram")}>
                  <div className="tile-logo">IG</div>
                  <div className="tile-name">Instagram</div>
                </button>
              </div>
            )}

            {modalStep === "search" && selectedNetwork === "instagram" && (
              <div className="account-step">
                <div
                  className="account-search"
                  style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: ".5rem" }}
                >
                  <input
                    type="text"
                    placeholder="Buscar cuenta (@usuario o nombre)…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") doSearch(); }}
                  />
                  <button className="induction-btn subtle" onClick={doSearch} disabled={!canSearch || loading}>
                    {loading ? "Buscando…" : "Buscar"}
                  </button>
                </div>

                <div className="account-list">
                  {error && <div className="no-results">{error}</div>}
                  {!error && results.map((a) => (
                    <button key={a.id || a.username} className="account-item" onClick={() => chooseAccount(a)}>
                      <div className="avatar small">@</div>
                      <div className="account-meta">
                        <div className="account-user">@{a.username} {a.is_verified && "✔"}</div>
                        <div className="account-name">{a.full_name || "—"}</div>
                      </div>
                      <div className="account-kpis">
                        <span>id: {a.id}</span>
                      </div>
                    </button>
                  ))}
                  {!error && !loading && results.length === 0 && (
                    <div className="no-results">
                      Escribe al menos 2 caracteres y pulsa Buscar
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
};

export default Panel;
