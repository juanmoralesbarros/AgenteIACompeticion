import React from "react";
import "./Chat.css";

const Chat: React.FC = () => {
  return (
    <>
      <header className="chat-header">
        <h2>Chatbot</h2>
        <p>Interactúa con tu asistente</p>
      </header>

      {/* Pantalla de presentación (no conversación aún) */}
      <div className="chat-landing">
        <div className="chat-landing-inner">
          <div className="chat-logo">◎</div>
          <h3>Bienvenido a AgenteIA</h3>
          <p className="hint">
            Conecta una red social o carga un archivo para empezar.
            <br />
            También puedes preguntarme cómo preparar tus datos.
          </p>
          <div className="quick-examples">
            <span className="chip">¿Qué formatos de archivo aceptas?</span>
            <span className="chip">¿Cómo conecto mi cuenta de Instagram?</span>
            <span className="chip">Muestra un ejemplo de scoring</span>
          </div>
        </div>
      </div>

      {/* Input desactivado visualmente hasta que haya flujo */}
      <form className="chat-input" onSubmit={(e) => e.preventDefault()}>
        <input
          type="text"
          placeholder="Escribe un mensaje..."
          disabled
          aria-disabled="true"
        />
        <button type="button" className="send-btn induction-btn subtle" disabled>
          Enviar
        </button>
      </form>
    </>
  );
};

export default Chat;
