import React from 'react';
import { Link } from 'react-router-dom';
import { Music, Radio, Users, Zap, Headphones, ArrowRight } from 'lucide-react';

export default function LandingPage() {
  return (
    <div className="relative min-h-screen flex flex-col">
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-[40%] -left-[20%] w-[80vw] h-[80vw] rounded-full bg-spotify-green/[0.07] blur-[120px]" />
        <div className="absolute -bottom-[30%] -right-[20%] w-[60vw] h-[60vw] rounded-full bg-accent-violet/[0.07] blur-[100px]" />
        <div className="absolute top-[20%] right-[10%] w-[30vw] h-[30vw] rounded-full bg-accent-cyan/[0.05] blur-[80px]" />
      </div>

      <nav className="relative z-10 flex items-center justify-between px-6 md:px-12 py-6">
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 rounded-xl bg-spotify-green/20 border border-spotify-green/30 flex items-center justify-center">
            <Radio className="w-5 h-5 text-spotify-green" />
          </div>
          <span className="font-['Outfit'] font-bold text-xl tracking-tight">SpotiSync</span>
        </div>
      </nav>

      <main className="relative z-10 flex-1 flex flex-col items-center justify-center px-6 text-center max-w-5xl mx-auto">
        <div className="animate-bounce-in">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-glass mb-8">
            <div className="w-2 h-2 rounded-full bg-spotify-green animate-pulse" />
            <span className="text-sm text-white/70 font-medium">Collaborative listening, live</span>
          </div>
        </div>

        <h1 className="font-['Outfit'] font-extrabold text-5xl sm:text-6xl md:text-7xl lg:text-8xl leading-[0.95] tracking-tight mb-6 animate-slide-up">
          Listen <span className="text-gradient">together</span>,
          <br />
          in perfect sync
        </h1>

        <p className="text-lg md:text-xl text-white/50 max-w-2xl mb-12 animate-slide-up" style={{ animationDelay: '0.1s' }}>
          One host, one session code. Everyone queues tracks, everyone hears
          the music — synchronized across every device in the room.
        </p>

        <div className="flex flex-col sm:flex-row gap-4 animate-slide-up" style={{ animationDelay: '0.2s' }}>
          <Link
            to="/host"
            className="group inline-flex items-center gap-3 px-8 py-4 rounded-2xl bg-spotify-green text-black font-semibold text-lg transition-all hover:scale-105 hover:shadow-[0_0_40px_rgba(29,185,84,0.4)]"
          >
            <Headphones className="w-5 h-5" />
            Host a Session
            <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
          </Link>
          <Link
            to="/join"
            className="inline-flex items-center gap-3 px-8 py-4 rounded-2xl bg-glass-strong text-white font-semibold text-lg transition-all hover:scale-105 hover:bg-white/[0.12]"
          >
            <Users className="w-5 h-5" />
            Join a Room
          </Link>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mt-24 w-full max-w-3xl">
          {[
            { icon: Zap, title: 'Real-time Sync', desc: 'Playback synced across all connected devices' },
            { icon: Music, title: 'Shared Queue', desc: 'Everyone searches & adds tracks collaboratively' },
            { icon: Users, title: 'Party Control', desc: 'Host controls playback, guests control the vibe' },
          ].map((f, i) => (
            <div
              key={f.title}
              className="p-6 rounded-2xl bg-glass text-left animate-slide-up"
              style={{ animationDelay: `${0.3 + i * 0.1}s` }}
            >
              <div className="w-10 h-10 rounded-xl bg-white/[0.06] flex items-center justify-center mb-4">
                <f.icon className="w-5 h-5 text-spotify-green" />
              </div>
              <h3 className="font-['Outfit'] font-semibold text-white mb-1">{f.title}</h3>
              <p className="text-sm text-white/40">{f.desc}</p>
            </div>
          ))}
        </div>
      </main>

      <footer className="relative z-10 text-center py-8 text-white/20 text-sm">
        Built with Spotify Web API & Web Playback SDK
      </footer>
    </div>
  );
}
