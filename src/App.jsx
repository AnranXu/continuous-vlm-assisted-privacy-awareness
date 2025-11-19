// src/App.jsx
import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import InstructionsPage from './pages/InstructionsPage.jsx';
import AnnotatePage from './pages/AnnotatePage.jsx';
import CompletePage from './pages/CompletePage.jsx';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<InstructionsPage />} />
      <Route path="/annotate" element={<AnnotatePage />} />
      <Route path="/complete" element={<CompletePage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
