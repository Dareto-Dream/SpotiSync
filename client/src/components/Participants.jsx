import React from 'react';
import { Users } from 'lucide-react';

const COLORS = [
  'bg-spotify-green/20 text-spotify-green',
  'bg-accent-cyan/20 text-accent-cyan',
  'bg-accent-violet/20 text-accent-violet',
  'bg-accent-pink/20 text-accent-pink',
  'bg-accent-lime/20 text-accent-lime',
  'bg-orange-500/20 text-orange-400',
  'bg-sky-500/20 text-sky-400',
  'bg-rose-500/20 text-rose-400',
];

export default function Participants({ participants }) {
  if (participants.length === 0) {
    return (
      <div className="text-center py-16">
        <Users className="w-10 h-10 text-white/[0.06] mx-auto mb-4" />
        <p className="text-white/20 text-sm">No one here yet</p>
        <p className="text-white/10 text-xs mt-1">Share the room code to invite people</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs uppercase tracking-[0.15em] text-white/20 font-medium px-3 mb-3">
        In the Room — {participants.length} {participants.length === 1 ? 'person' : 'people'}
      </p>

      {participants.map((p, i) => {
        const color = COLORS[i % COLORS.length];
        const initial = (p.name || 'G')[0].toUpperCase();
        const joinedAgo = getTimeAgo(p.joinedAt);

        return (
          <div
            key={`${p.name}-${i}`}
            className="flex items-center gap-3 p-3 rounded-xl hover:bg-white/[0.03] transition-all animate-slide-in"
            style={{ animationDelay: `${i * 0.05}s` }}
          >
            <div className={`w-10 h-10 rounded-xl ${color} flex items-center justify-center font-bold text-sm shrink-0`}>
              {initial}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">{p.name}</p>
              <p className="text-xs text-white/25">{joinedAgo}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function getTimeAgo(timestamp) {
  if (!timestamp) return 'Just now';
  const diff = Date.now() - timestamp;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ago`;
}
