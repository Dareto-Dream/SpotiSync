import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { RoomProvider } from './context/RoomContext';
import ProtectedRoute from './components/ProtectedRoute';
import AuthPage from './modules/auth/AuthPage';
import LobbyPage from './modules/room/LobbyPage';
import RoomPage from './modules/room/RoomPage';

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <RoomProvider>
          <Routes>
            <Route path="/login" element={<AuthPage />} />
            <Route path="/" element={
              <ProtectedRoute>
                <LobbyPage />
              </ProtectedRoute>
            } />
            <Route path="/room/:code" element={
              <ProtectedRoute>
                <RoomPage />
              </ProtectedRoute>
            } />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </RoomProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
