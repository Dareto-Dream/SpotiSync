import React from 'react';

function LoginScreen({ onLogin }) {
  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-icon">🎵</div>
        <h1>Spotify Rooms</h1>
        <p>Collaborative music listening experience</p>
        <button onClick={onLogin} className="btn-primary btn-large">
          Login with Spotify
        </button>
        <p className="login-note">Spotify Premium required</p>
      </div>
    </div>
  );
}

export default LoginScreen;
