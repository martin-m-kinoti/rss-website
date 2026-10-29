import React from "react";
import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom"
import HomePage from "./components/homePage";

function App() {

  return (
    <Router>
      <Routes>
        <Route path="/" element={<HomePage />} />
      </Routes>
    </Router>
  );
}

export default App;