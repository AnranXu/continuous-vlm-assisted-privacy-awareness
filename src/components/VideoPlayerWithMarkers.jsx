// src/components/VideoPlayerWithMarkers.jsx
import React, { useEffect, useRef, useState } from 'react';

/**
 * Video player with optional forward-seek lock, marker timeline, and
 * automatic pause when the tab/window loses focus.
 */
export default function VideoPlayerWithMarkers({
  videoUrl,
  markers,
  allowForwardSeek = true,
  pauseWhenInactive = false,
  onEnded
}) {
  const videoRef = useRef(null);
  const [duration, setDuration] = useState(0);
  const lastAllowedTimeRef = useRef(0);
  const ignoreSeekRef = useRef(false);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onLoaded = () => {
      setDuration(v.duration || 0);
      lastAllowedTimeRef.current = 0;
    };
    v.addEventListener('loadedmetadata', onLoaded);
    return () => v.removeEventListener('loadedmetadata', onLoaded);
  }, [videoUrl]);

  useEffect(() => {
    lastAllowedTimeRef.current = 0;
    ignoreSeekRef.current = false;
    if (videoRef.current) {
      videoRef.current.currentTime = 0;
    }
  }, [videoUrl]);

  useEffect(() => {
    if (!pauseWhenInactive || typeof document === 'undefined') return undefined;

    const handleVisibility = () => {
      if (document.hidden && videoRef.current) {
        videoRef.current.pause();
      }
    };

    const handleBlur = () => {
      if (videoRef.current) {
        videoRef.current.pause();
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    const hasWindow = typeof window !== 'undefined';
    if (hasWindow) {
      window.addEventListener('blur', handleBlur);
    }

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      if (hasWindow) {
        window.removeEventListener('blur', handleBlur);
      }
    };
  }, [pauseWhenInactive]);

  const handleTimeUpdate = () => {
    if (allowForwardSeek) return;
    const v = videoRef.current;
    if (!v) return;
    const current = v.currentTime || 0;
    const allowed = lastAllowedTimeRef.current;

    if (!ignoreSeekRef.current && current > allowed + 0.6) {
      ignoreSeekRef.current = true;
      v.currentTime = allowed;
      setTimeout(() => {
        ignoreSeekRef.current = false;
      }, 0);
      return;
    }

    if (!ignoreSeekRef.current) {
      lastAllowedTimeRef.current = Math.max(allowed, current);
    }
  };

  const handleSeeking = () => {
    if (allowForwardSeek || ignoreSeekRef.current) return;
    const v = videoRef.current;
    if (!v) return;
    const allowed = lastAllowedTimeRef.current;
    if (v.currentTime <= allowed + 0.05) return;
    ignoreSeekRef.current = true;
    v.currentTime = allowed;
    setTimeout(() => {
      ignoreSeekRef.current = false;
    }, 0);
  };

  const handleMarkerJump = (pct) => {
    if (!videoRef.current || !duration) return;
    const target = pct * duration;
    const allowed = allowForwardSeek
      ? target
      : Math.min(target, lastAllowedTimeRef.current);
    ignoreSeekRef.current = true;
    videoRef.current.currentTime = allowed;
    setTimeout(() => {
      ignoreSeekRef.current = false;
    }, 0);
  };

  const handleEnded = (event) => {
    if (!allowForwardSeek && duration) {
      lastAllowedTimeRef.current = duration;
    }
    if (onEnded) {
      onEnded(event);
    }
  };

  return (
    <div className="video-wrap card">
      {videoUrl ? (
        <>
          <video
            ref={videoRef}
            src={videoUrl}
            controls
            style={{ width: '100%' }}
            onTimeUpdate={handleTimeUpdate}
            onSeeking={handleSeeking}
            onSeeked={handleSeeking}
            onEnded={handleEnded}
          />
          <div className="timeline">
            <div className="bar" />
            {(markers || []).map((m) => (
              <div
                key={m.det_id}
                className="marker"
                title={m.label}
                style={{ left: `${m.pct * 100}%` }}
                onClick={() => handleMarkerJump(m.pct)}
              />
            ))}
          </div>
        </>
      ) : (
        <p>No video loaded.</p>
      )}
    </div>
  );
}
