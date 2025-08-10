import React from "react";
import { BrowserRouter as Router, Routes, Route, Link } from "react-router-dom";
import Pestaña from "./Pestana/Pestana";

function App() {
  return (
    <Router>
      <nav style={{ display: "flex", gap: "1rem", padding: "1rem" }}>
        <Link to="/">Instagram Panel</Link>
        <Link to="/kpi-legal">KPI Legal</Link>
      </nav>
      <Routes>
        <Route path="/" element={<Pestaña />} />

      </Routes>
    </Router>
  );
}

export default App;
