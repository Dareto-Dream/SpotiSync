import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  VolumeX,
  Volume2,
  SkipBack,
  SkipForward,
  Play,
  Pause,
  Image,
  Clapperboard,
  Lock,
  PlayCircle,
  Music2,
  Gavel,
  ThumbsUp,
  ThumbsDown,
} from 'lucide-react';
import { useRoom } from '../../context/RoomContext';
import { useAuth } from '../../context/AuthContext';
import { useYouTubePlayer } from './useYouTubePlayer';
import styles from './Player.module.css';

export default function Player({ large = false }) {
  const { playback, isHost, send, room, feedback } = useRoom();
  const { user } = useAuth();
  const [videoMode, setVideoMode] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const syncRef = useRef(null);
  const currentVideoIdRef = useRef(null);

  const onEnded = useCallback(() => {
    if (isHost) {
      send('playback_skip', { trackId: playback?.currentItem?.videoId });
    }
  }, [isHost, send, playback]);

  const {
    playerState, isMuted,
    unlockAndPlay, play, pause, seekTo, getCurrentTimeMs,
    toggleMute, syncToServer, loadVideo,
  } = useYouTubePlayer({
    containerId: 'yt-player',
    onEnded,
    onReady: () => {},
  });

  // Load new track when currentItem changes
  useEffect(() => {
    if (!playback?.currentItem) return;
    const { videoId } = playback.currentItem;
    if (videoId === currentVideoIdRef.current) return;
    currentVideoIdRef.current = videoId;

    const startMs = playback.isPlaying
      ? playback.positionMs + (Date.now() - playback.serverTime)
      : playback.positionMs;

    if (unlocked) {
      unlockAndPlay(videoId, startMs);
    } else {
      loadVideo(videoId, startMs);
    }
  }, [playback?.currentItem?.videoId]);

  // Sync to server state periodically
  useEffect(() => {
    clearInterval(syncRef.current);
    syncRef.current = setInterval(() => {
      if (!playback || !unlocked) return;
      const livePos = playback.isPlaying
        ? playback.positionMs + (Date.now() - playback.serverTime)
        : playback.positionMs;
      syncToServer(livePos, playback.isPlaying);
    }, 5000);
    return () => clearInterval(syncRef.current);
  }, [playback, unlocked, syncToServer]);

  // Respond to play/pause from server
  useEffect(() => {
    if (!unlocked || !playback) return;
    const livePos = playback.isPlaying
      ? playback.positionMs + (Date.now() - playback.serverTime)
      : playback.positionMs;
    syncToServer(livePos, playback.isPlaying, 1000);
  }, [playback?.isPlaying]);

  // Respond to seek from server
  useEffect(() => {
    if (!unlocked || !playback) return;
    seekTo(playback.positionMs);
  }, [playback?.serverTime]);

  const handleUnlock = () => {
    setUnlocked(true);
    if (playback?.currentItem) {
      const livePos = playback.isPlaying
        ? playback.positionMs + (Date.now() - playback.serverTime)
        : playback.positionMs;
      unlockAndPlay(playback.currentItem.videoId, livePos);
    }
  };

  const handleHostPause = () => {
    if (!isHost) return;
    const pos = getCurrentTimeMs();
    send('playback_pause', { positionMs: pos });
  };

  const handleHostPlay = () => {
    if (!isHost) return;
    send('playback_play', {});
  };

  const track = playback?.currentItem;
  const isPlaying = playback?.isPlaying;
  const userId = user?.id;

  const likes = feedback?.likes?.length || 0;
  const dislikes = feedback?.dislikes?.length || 0;
  const userChoice = userId
    ? (feedback?.likes?.includes(userId) ? 'approve' : feedback?.dislikes?.includes(userId) ? 'disapprove' : null)
    : null;

  const artUrl = track?.thumbnailUrl ? getHiResThumb(track.thumbnailUrl) : null;

  const handleFeedback = (value) => {
    if (!track) return;
    send('autoplay_feedback', { trackId: track.videoId, value });
  };

  const wrapperClass = `${styles.playerWrap} ${large ? styles.large : ''}`;

  return (
    <div className={wrapperClass}>
      {/* YouTube IFrame - always mounted, visibility toggled */}
      <div className={styles.ytContainer} style={{ display: videoMode && unlocked ? 'block' : 'none' }}>
        <div id="yt-player" style={{ width: '100%', height: '100%' }} />
      </div>

      {/* Album Art Mode */}
      {(!videoMode || !unlocked) && (
        <div className={styles.albumArt}>
          {artUrl ? (
            <img src={artUrl} alt={track.title} className={styles.artwork} loading="lazy" />
          ) : (
            <div className={styles.noArt}>
              <Music2 size={20} />
            </div>
          )}
        </div>
      )}

      {/* Track Info */}
      <div className={styles.trackInfo}>
        {track ? (
          <>
            <div className={styles.trackTitle}>{track.title}</div>
            <div className={styles.trackArtist}>{track.artist}</div>
          </>
        ) : (
          <div className={styles.noTrack}>Nothing playing</div>
        )}
      </div>

      {/* Controls */}
      <div className={styles.controls}>
        {/* Mute (all users) */}
        <button
          className={`${styles.controlBtn} ${isMuted ? styles.active : ''}`}
          onClick={toggleMute}
          title={isMuted ? 'Unmute' : 'Mute'}
        >
          {isMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
        </button>

        {/* Play/Pause (host only) */}
        {isHost && (
          <>
            <button
              className={styles.controlBtn}
              onClick={() => send('playback_prev', { trackId: track?.videoId })}
              disabled={!track}
              title="Previous / Restart"
            >
              <SkipBack size={18} />
            </button>
            <button
              className={`${styles.controlBtn} ${styles.playBtn}`}
              onClick={isPlaying ? handleHostPause : handleHostPlay}
              disabled={!track}
              title={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? <Pause size={20} /> : <Play size={20} />}
            </button>
            <button
              className={styles.controlBtn}
              onClick={() => send('playback_skip', { trackId: track?.videoId })}
              disabled={!track}
              title="Skip"
            >
              <SkipForward size={18} />
            </button>
          </>
        )}

        {/* Skip vote (non-host) */}
        {!isHost && track && (
          <button
            className={styles.controlBtn}
            onClick={() => send('vote', { action: 'skip', trackId: track.videoId })}
            title={`Vote to skip (${room?.settings?.userSkipMode === 'instant' ? 'instant' : 'vote'})`}
          >
            {room?.settings?.userSkipMode === 'instant'
              ? <SkipForward size={18} />
              : <Gavel size={18} />}
          </button>
        )}

        {/* Taste feedback (all users) */}
        {track && (
          <div className={styles.feedbackGroup}>
            <button
              className={`${styles.controlBtn} ${styles.feedbackBtn} ${userChoice === 'approve' ? styles.active : ''}`}
              onClick={() => handleFeedback('approve')}
              title="Approve (more like this)"
            >
              <ThumbsUp size={16} />
              <span className={styles.feedbackCount}>{likes}</span>
            </button>
            <button
              className={`${styles.controlBtn} ${styles.feedbackBtn} ${userChoice === 'disapprove' ? styles.active : ''}`}
              onClick={() => handleFeedback('disapprove')}
              title="Disapprove (less like this)"
            >
              <ThumbsDown size={16} />
              <span className={styles.feedbackCount}>{dislikes}</span>
            </button>
          </div>
        )}

        {/* Video Mode Toggle */}
        <button
          className={`${styles.controlBtn} ${videoMode ? styles.active : ''}`}
          onClick={() => setVideoMode(v => !v)}
          title={videoMode ? 'Album Art Mode' : 'Video Mode'}
        >
          {videoMode ? <Image size={18} /> : <Clapperboard size={18} />}
        </button>
      </div>

      {/* Autoplay unlock overlay */}
      {!unlocked && track && (
        <div className={styles.unlockOverlay} onClick={handleUnlock}>
          <div className={styles.unlockBtn}>
            <PlayCircle size={18} />
            <span>Tap to start audio</span>
          </div>
        </div>
      )}

      {/* Locked indicator */}
      {playerState === 'locked' && !unlocked && track && (
        <div className={styles.statusPill}>
          <Lock size={14} style={{ marginRight: 6 }} />
          Tap to unlock audio
        </div>
      )}
    </div>
  );
}

function getHiResThumb(url = '') {
  try {
    const u = new URL(url);
    if (u.hostname.includes('ytimg.com')) {
      u.pathname = u.pathname.replace(/\/(mq|hq|sd|maxres)default(\.\w+)?$/i, '/maxresdefault.jpg');
    }
    return u.toString();
  } catch {
    return url;
  }
}
