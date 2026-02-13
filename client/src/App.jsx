import React from 'react';
import { Routes, Route } from 'react-router-dom';
import { SocketProvider } from './context/SocketContext';
import LandingPage from './pages/LandingPage';
import HostPage from './pages/HostPage';
import RoomPage from './pages/RoomPage';
import JoinPage from './pages/JoinPage';

export default function App() {
  return (
    <SocketProvider>
      <div className="noise min-h-screen">
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/host" element={<HostPage />} />
          <Route path="/join" element={<JoinPage />} />
          <Route path="/room/:sessionId" element={<RoomPage />} />
        </Routes>
      </div>
    </SocketProvider>
  );
}
