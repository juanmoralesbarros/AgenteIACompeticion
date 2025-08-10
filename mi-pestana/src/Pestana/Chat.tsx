import React, { useEffect, useRef, useState } from "react";
import "./Chat.css";
import { ChatWebSocket } from "../services/utilesChat";
import Dashboard from "./Dashboard"; // 👈 importa el componente real

const SHOW_DASHBOARD = true; // ⬅️ Ponlo en true para mostrar el Dashboard

const Chip: React.FC<{ onClick?: () => void; children: React.ReactNode }> = ({ onClick, children }) => (
  <span className="chip" onClick={onClick} role="button" tabIndex={0}>{children}</span>
);

interface Message {
  sender: "user" | "bot";
  text: string;
}

const Chat: React.FC = () => {
  const [connected, setConnected] = useState(false);
  const [started, setStarted] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");

  const wsRef = useRef<ChatWebSocket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ws = new ChatWebSocket(
      "ws://localhost:8000/api/v1/ws", // Cambia si es producción
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
      </header>

      <div className="chat-body">
        {SHOW_DASHBOARD ? (
          // 🔹 Muestra el Dashboard real
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
      </div>

      {!SHOW_DASHBOARD && (
        <form className="chat-input" onSubmit={(e) => { e.preventDefault(); handleSend(); }}>
          <input
            type="text"
            placeholder="Escribe un mensaje..."
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
