import React, { useState, useRef } from "react";
import "./Pestana.css";
import Panel from "./Panel";
import Chat from "./Chat";

const Pestana: React.FC = () => {
  // --- Estado para el panel de carga (modal) ---
  const [showUploader, setShowUploader] = useState(false);
  const [droppedFiles, setDroppedFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const openUploader = () => setShowUploader(true);
  const closeUploader = () => {
    setShowUploader(false);
    setDroppedFiles([]);
  };

  // Drag & Drop nativo (sin subir nada aún)
  const handleDragOver: React.DragEventHandler<HTMLDivElement> = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };

  const handleDrop: React.DragEventHandler<HTMLDivElement> = (e) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length) setDroppedFiles(files);
  };

  const handleBrowse = () => fileInputRef.current?.click();

  const handleChooseFiles: React.ChangeEventHandler<HTMLInputElement> = (e) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    if (files.length) setDroppedFiles(files);
  };

  return (
    <div className="main-container">
      <div className="grid-root">{/* 1fr : 2fr (panel : chat) */}
        <section className="card card-panel tone-panel">
          <Panel onOpenUploader={openUploader} />
        </section>

        <section className="card card-chat tone-chat">
          <Chat />
        </section>
      </div>

      {/* ---------- Modal Uploader (control lógico listo) ---------- */}
      {showUploader && (
        <div className="uploader-overlay" onClick={closeUploader}>
          <div
            className="uploader-modal"
            onClick={(e) => e.stopPropagation()}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
          >
            <header className="uploader-head">
              <h3>Sube tus archivos</h3>
              <button className="uploader-close" onClick={closeUploader}>
                ✕
              </button>
            </header>

            <div className="dropzone">
              <div className="dropzone-guide">
                <strong>Arrastra aquí</strong> tus PDF, Excel o CSV
                <span className="dropzone-sub">o</span>
                <button className="browse-btn" onClick={handleBrowse} type="button">
                  Buscar archivos
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.csv,.xlsx,.xls"
                  multiple
                  hidden
                  onChange={handleChooseFiles}
                />
              </div>
            </div>

            {droppedFiles.length > 0 && (
              <div className="files-list">
                <p className="files-title">Archivos listos:</p>
                <ul>
                  {droppedFiles.map((f, i) => (
                    <li key={i}>
                      <span className="file-name">{f.name}</span>
                      <span className="file-size">
                        {(f.size / 1024).toFixed(1)} KB
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <footer className="uploader-foot">
              <button className="btn-secondary" onClick={closeUploader}>Cancelar</button>
              <button
                className="btn-primary"
                type="button"
                onClick={() => alert("Aquí iría tu lógica de carga/parseo 😄")}
                disabled={droppedFiles.length === 0}
              >
                Procesar
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
};

export default Pestana;
