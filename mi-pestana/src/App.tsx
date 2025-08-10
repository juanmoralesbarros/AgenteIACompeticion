import React from "react";
import { BrowserRouter as Router, Routes, Route, Link } from "react-router-dom";
import Pestaña from "./Pestana/Pestana";

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Pestaña />} />

      </Routes>
    </Router>
  );
}

export default App;
