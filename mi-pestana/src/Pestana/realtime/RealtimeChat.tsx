import React, { useEffect, useRef, useState } from "react";
import { ChatWebSocket } from "../../services/utilesChat";
import Dashboard from "../Dashboard";

interface Message { sender: "user" | "bot"; text: string; }

const RealtimeChat: React.FC<{ showDashboard?: boolean }> = ({ showDashboard = true }) => {
  const [connected, setConnected] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");

  const wsRef = useRef<ChatWebSocket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
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
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim()) return;
    setMessages((prev) => [...prev, { sender: "user", text: input }]);
    wsRef.current?.send(input);
    setInput("");
  };

  if (showDashboard) {
    return <Dashboard />;
  }

  return (
    <>
      <div className="chat-messages">
        {messages.map((m, i) => (
          <div key={i} className={`chat-message ${m.sender}`}>
            {m.text}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>
      <form className="chat-input" onSubmit={handleSend}>
        <input
          type="text"
          placeholder={connected ? "Escribe un mensaje..." : "Conectando..."}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={!connected}
        />
        <button type="submit" className="send-btn induction-btn subtle" disabled={!connected}>Enviar</button>
      </form>
    </>
  );
};

export default RealtimeChat;
