import React, { useState, useEffect, useRef } from 'react';
import { Music4 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import styles from './AuthPage.module.css';

export default function AuthPage() {
  const [mode, setMode] = useState('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [googleReady, setGoogleReady] = useState(false);
  const googleBtnRef = useRef(null);
  const { login, register, loginWithGoogle } = useAuth();
  const navigate = useNavigate();
  const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;

  useEffect(() => {
    if (!googleClientId || googleReady) return;
    function init() {
      if (!window.google?.accounts?.id || !googleBtnRef.current) return;
      window.google.accounts.id.initialize({
        client_id: googleClientId,
        callback: async ({ credential }) => {
          if (!credential) return;
          setLoading(true);
          setError(null);
          try {
            await loginWithGoogle(credential);
            navigate('/');
          } catch (err) {
            setError(err.message);
          } finally {
            setLoading(false);
          }
        },
        ux_mode: 'popup',
      });
      window.google.accounts.id.renderButton(googleBtnRef.current, {
        theme: 'outline',
        size: 'large',
        shape: 'pill',
        width: 320,
      });
      setGoogleReady(true);
    }

    if (window.google?.accounts?.id) {
      init();
    } else {
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.onload = init;
      document.body.appendChild(script);
    }
  }, [googleClientId, googleReady, loginWithGoogle, navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (mode === 'login') await login(username, password);
      else await register(username, password);
      navigate('/');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.logo}><Music4 size={24} strokeWidth={1.75} /></div>
        <h1 className={styles.title}>Jam Mode</h1>
        <p className={styles.sub}>Collaborative listening with friends</p>

        <div className={styles.tabs}>
          <button
            className={`${styles.tab} ${mode === 'login' ? styles.active : ''}`}
            onClick={() => setMode('login')}
          >Sign In</button>
          <button
            className={`${styles.tab} ${mode === 'register' ? styles.active : ''}`}
            onClick={() => setMode('register')}
          >Create Account</button>
        </div>

        <form onSubmit={handleSubmit} className={styles.form}>
          {error && <div className={styles.error}>{error}</div>}
          <input
            type="text"
            placeholder="Username"
            value={username}
            onChange={e => setUsername(e.target.value)}
            required
            autoFocus
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
          />
          <button type="submit" className="btn btn-primary w-full" disabled={loading}>
            {loading ? <span className="spinner" /> : mode === 'login' ? 'Sign In' : 'Create Account'}
          </button>
        </form>

        {googleClientId && (
          <>
            <div className={styles.divider}><span>or</span></div>
            <div ref={googleBtnRef} className={styles.googleBtnContainer} />
          </>
        )}
      </div>
    </div>
  );
}
