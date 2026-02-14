import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Radio, LogIn, Loader2, Copy, Check, ArrowRight } from 'lucide-react';
import { useSocket } from '../context/SocketContext';

export default function HostPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { connect } = useSocket();

  const [accessToken, setAccessToken] = useState(null);
  const [refreshToken, setRefreshToken] = useState(null);
  const [expiresIn, setExpiresIn] = useState(null);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);
  const [profile, setProfile] = useState(null);

  useEffect(() => {
    const at = searchParams.get('access_token');
    const rt = searchParams.get('refresh_token');
    const ei = searchParams.get('expires_in');
    const err = searchParams.get('error');

    if (err) setError(err);
    if (at) {
      setAccessToken(at);
      setRefreshToken(rt);
      setExpiresIn(ei);
      window.history.replaceState({}, '', '/host');
    }
  }, [searchParams]);

  useEffect(() => {
    if (!accessToken || session) return;

    const createSession = async () => {
      setLoading(true);
      try {
        const res = await fetch('/api/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accessToken, refreshToken, expiresIn: Number(expiresIn) }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        setSession(data);

        const profileRes = await fetch(`/api/spotify/me?sessionId=${data.sessionId}`);
        const profileData = await profileRes.json();
        setProfile(profileData);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    createSession();
  }, [accessToken, session, refreshToken, expiresIn]);

  const handleLogin = () => {
    window.location.href = '/api/auth/login';
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(session.joinCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleEnterRoom = () => {
    sessionStorage.setItem('spotisync_host', JSON.stringify({
      accessToken,
      refreshToken,
      sessionId: session.sessionId,
      isHost: true,
    }));
    connect();
    navigate(`/room/${session.sessionId}`);
  };

  return (
    <div className="relative min-h-screen flex flex-col items-center justify-center px-6">
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[10%] left-[20%] w-[50vw] h-[50vw] rounded-full bg-spotify-green/[0.06] blur-[120px]" />
        <div className="absolute bottom-[10%] right-[10%] w-[40vw] h-[40vw] rounded-full bg-accent-violet/[0.06] blur-[100px]" />
      </div>

      <div className="relative z-10 w-full max-w-md">
        <div className="flex items-center gap-2 mb-12">
          <div className="w-10 h-10 rounded-xl bg-spotify-green/20 border border-spotify-green/30 flex items-center justify-center">
            <Radio className="w-5 h-5 text-spotify-green" />
          </div>
          <span className="font-['Outfit'] font-bold text-xl tracking-tight">SpotiSync</span>
          <span className="ml-2 px-2 py-0.5 rounded-md bg-white/[0.06] text-xs text-white/40 font-medium">HOST</span>
        </div>

        {error && (
          <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
            {error === 'state_mismatch' ? 'Auth state mismatch. Please try again.' : error}
          </div>
        )}

        {!accessToken && !loading && (
          <div className="animate-slide-up">
            <h2 className="font-['Outfit'] font-bold text-3xl mb-3">Start a Session</h2>
            <p className="text-white/40 mb-8">
              Sign in with your Spotify Premium account to host a collaborative listening session.
            </p>
            <button
              onClick={handleLogin}
              className="group w-full flex items-center justify-center gap-3 px-6 py-4 rounded-2xl bg-spotify-green text-black font-semibold text-lg transition-all hover:scale-[1.02] hover:shadow-[0_0_40px_rgba(29,185,84,0.4)]"
            >
              <LogIn className="w-5 h-5" />
              Sign in with Spotify
              <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
            </button>
            <p className="text-xs text-white/20 text-center mt-4">
              Requires Spotify Premium for playback
            </p>
          </div>
        )}

        {loading && (
          <div className="flex flex-col items-center gap-4 py-12">
            <Loader2 className="w-8 h-8 text-spotify-green animate-spin" />
            <p className="text-white/40">Creating your session...</p>
          </div>
        )}

        {session && (
          <div className="animate-slide-up space-y-6">
            {profile && (
              <div className="flex items-center gap-3 p-4 rounded-2xl bg-glass">
                {profile.images?.[0] && (
                  <img src={profile.images[0].url} alt="" className="w-10 h-10 rounded-full" />
                )}
                <div>
                  <p className="font-medium text-sm">{profile.display_name}</p>
                  <p className="text-xs text-white/40">Host</p>
                </div>
              </div>
            )}

            <div>
              <h2 className="font-['Outfit'] font-bold text-3xl mb-2">Session Ready!</h2>
              <p className="text-white/40 text-sm">Share this code with your friends to join.</p>
            </div>

            <div className="relative p-8 rounded-3xl bg-glass-strong text-center">
              <p className="text-xs uppercase tracking-[0.2em] text-white/30 mb-4 font-medium">Join Code</p>
              <div className="font-['JetBrains_Mono'] text-5xl font-bold tracking-[0.3em] text-gradient">
                {session.joinCode}
              </div>
              <button
                onClick={handleCopy}
                className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white/[0.06] text-white/60 text-sm transition-all hover:bg-white/[0.1] hover:text-white"
              >
                {copied ? <Check className="w-4 h-4 text-spotify-green" /> : <Copy className="w-4 h-4" />}
                {copied ? 'Copied!' : 'Copy code'}
              </button>
            </div>

            <button
              onClick={handleEnterRoom}
              className="group w-full flex items-center justify-center gap-3 px-6 py-4 rounded-2xl bg-spotify-green text-black font-semibold text-lg transition-all hover:scale-[1.02] hover:shadow-[0_0_40px_rgba(29,185,84,0.4)]"
            >
              Enter Room
              <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
