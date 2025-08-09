import React, { useEffect, useMemo, useState } from "react";
import "./Panel.css";
import {
  searchInstagramUsers,
  InstagramSearchItem,
  getInstagramInfo,
    getSelectedInstagram,
  saveSelectedInstagram,
  SelectedInstagram,
} from "../services/utilesPanel";

type PanelProps = {
  onOpenUploader: () => void;
};

const Panel: React.FC<PanelProps> = ({ onOpenUploader }) => {
  // selección persistente
  const [selectedAccount, setSelectedAccount] = useState<SelectedInstagram | null>(null);

  // modal + búsqueda
  const [showSocialModal, setShowSocialModal] = useState(false);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<InstagramSearchItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  // estado de carga de info-limpia
  const [loadingInfo, setLoadingInfo] = useState(false);

  useEffect(() => {
    const saved = getSelectedInstagram();
    if (saved) setSelectedAccount(saved);
  }, []);

  const canSearch = useMemo(() => query.trim().length >= 2, [query]);

  const openModal = () => {
    setShowSocialModal(true);
    setQuery("");
    setResults([]);
    setError(null);
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
    // preferimos ID; si no, username
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
    } catch (e: any) {
      setError(e?.message ?? "No se pudo obtener la información de la cuenta");
    } finally {
      setLoadingInfo(false);
    }
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

      <div className="panel-actions">
        {/* Red social */}
        <button className="induction-btn subtle" onClick={openModal}>
          <span className="led-dot" />
          <span className="btn-label">
            {selectedAccount ? (
              <>Instagram · <strong>@{selectedAccount.username}</strong></>
            ) : <>Red social</>}
          </span>
          <span className="btn-right">➜</span>
        </button>

        {/* Stats si hay selección */}
        {selectedAccount && (
          <section className="social-stats">
            <header className="stats-head">
              <div className="avatar">@</div>
              <div>
                <div className="user">
                  @{selectedAccount.username} {selectedAccount.isVerified && "✔"}
                </div>
                <div className="name">{selectedAccount.fullName || "Cuenta de Instagram"}</div>
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
            <p className="stats-note">
              {loadingInfo ? "Cargando información…" : "Datos desde info-limpia."}
            </p>
          </section>
        )}

        {/* Cargar datos */}
        <button className="induction-btn subtle" onClick={onOpenUploader}>
          <span className="led-dot" />
          <span className="btn-label">Cargar datos</span>
          <span className="btn-right">📎</span>
        </button>
      </div>

      {/* Brief */}
      <section className="panel-brief">
        <h3>Objetivo del Agente</h3>
        <p>
          Evaluar el <strong>riesgo financiero</strong> de PYMEs con señales alternativas
          y traducirlas en un <em>scoring</em> claro y justificable.
        </p>
      </section>

      {/* Modal: input + Buscar + resultados */}
      {showSocialModal && (
        <div className="social-modal-overlay" onClick={() => setShowSocialModal(false)}>
          <div className="social-modal" onClick={(e) => e.stopPropagation()}>
            <header className="social-modal-head">
              <h3>Conectar Instagram</h3>
              <button className="uploader-close" onClick={() => setShowSocialModal(false)}>✕</button>
            </header>

            <div className="account-step">
              <div className="account-search" style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: ".5rem" }}>
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
                  <div className="no-results">Escribe al menos 2 caracteres y pulsa Buscar</div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default Panel;
