import { createContext, useContext, useState, useEffect } from 'react';

const AppContext = createContext();

export function AppProvider({ children }) {
  const [user, setUser] = useState(() => {
    const saved = localStorage.getItem('jam_user');
    return saved ? JSON.parse(saved) : null;
  });

  const [room, setRoom] = useState(null);
  const [isHost, setIsHost] = useState(false);

  useEffect(() => {
    if (user) {
      localStorage.setItem('jam_user', JSON.stringify(user));
    } else {
      localStorage.removeItem('jam_user');
    }
  }, [user]);

  const login = (userId, displayName) => {
    setUser({ userId, displayName });
  };

  const logout = () => {
    setUser(null);
    setRoom(null);
    setIsHost(false);
  };

  const joinRoom = (roomCode, roomData, host = false) => {
    setRoom({ code: roomCode, ...roomData });
    setIsHost(host);
  };

  const leaveRoom = () => {
    setRoom(null);
    setIsHost(false);
  };

  return (
    <AppContext.Provider
      value={{
        user,
        room,
        isHost,
        login,
        logout,
        joinRoom,
        leaveRoom
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within AppProvider');
  }
  return context;
}
