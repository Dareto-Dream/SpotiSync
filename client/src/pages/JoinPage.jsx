import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Radio, Users, ArrowRight, Loader2, AlertCircle } from 'lucide-react';
import { useSocket } from '../context/SocketContext';

export default function JoinPage() {
  const navigate = useNavigate();
  const { connect } = useSocket();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleJoin = async (e) => {
    e.preventDefault();
    if (code.length < 4) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/sessions/join/${code.toUpperCase()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Session not found');

      sessionStorage.setItem('spotisync_guest', JSON.stringify({
        sessionId: data.sessionId,
        name: name || 'Guest',
        isHost: false,
      }));
      connect();
      navigate(`/room/${data.sessionId}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen flex flex-col items-center justify-center px-6">
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[20%] right-[20%] w-[50vw] h-[50vw] rounded-full bg-accent-cyan/[0.06] blur-[120px]" />
        <div className="absolute bottom-[20%] left-[10%] w-[40vw] h-[40vw] rounded-full bg-accent-pink/[0.05] blur-[100px]" />
      </div>

      <div className="relative z-10 w-full max-w-md">
        <div className="flex items-center gap-2 mb-12">
          <div className="w-10 h-10 rounded-xl bg-spotify-green/20 border border-spotify-green/30 flex items-center justify-center">
            <Radio className="w-5 h-5 text-spotify-green" />
          </div>
          <span className="font-['Outfit'] font-bold text-xl tracking-tight">SpotiSync</span>
          <span className="ml-2 px-2 py-0.5 rounded-md bg-white/[0.06] text-xs text-white/40 font-medium">JOIN</span>
        </div>

        <div className="animate-slide-up">
          <h2 className="font-['Outfit'] font-bold text-3xl mb-3">Join a Session</h2>
          <p className="text-white/40 mb-8">Enter the code shared by the host to join the party.</p>

          {error && (
            <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {error}
            </div>
          )}

          <form onSubmit={handleJoin} className="space-y-4">
            <div>
              <label className="block text-xs uppercase tracking-[0.15em] text-white/30 mb-2 font-medium">
                Your Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="What should we call you?"
                className="w-full px-5 py-4 rounded-2xl bg-white/[0.04] border border-white/[0.08] text-white placeholder:text-white/20 outline-none focus:border-spotify-green/40 focus:bg-white/[0.06] transition-all text-lg"
              />
            </div>

            <div>
              <label className="block text-xs uppercase tracking-[0.15em] text-white/30 mb-2 font-medium">
                Session Code
              </label>
              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))}
                placeholder="ABCDEF"
                className="w-full px-5 py-4 rounded-2xl bg-white/[0.04] border border-white/[0.08] text-white placeholder:text-white/20 outline-none focus:border-spotify-green/40 focus:bg-white/[0.06] transition-all font-['JetBrains_Mono'] text-3xl text-center tracking-[0.3em] font-bold"
                maxLength={6}
                autoComplete="off"
              />
            </div>

            <button
              type="submit"
              disabled={code.length < 4 || loading}
              className="group w-full flex items-center justify-center gap-3 px-6 py-4 rounded-2xl bg-spotify-green text-black font-semibold text-lg transition-all hover:scale-[1.02] hover:shadow-[0_0_40px_rgba(29,185,84,0.4)] disabled:opacity-40 disabled:hover:scale-100 disabled:cursor-not-allowed"
            >
              {loading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <>
                  <Users className="w-5 h-5" />
                  Join Room
                  <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
                </>
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
