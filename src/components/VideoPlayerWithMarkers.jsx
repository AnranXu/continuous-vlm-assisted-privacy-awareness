// src/components/VideoPlayerWithMarkers.jsx
import React, { useEffect, useRef, useState } from 'react';

export default function VideoPlayerWithMarkers({ videoUrl, markers }) {
  const videoRef = useRef(null);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onLoaded = () => setDuration(v.duration || 0);
    v.addEventListener('loadedmetadata', onLoaded);
    return () => v.removeEventListener('loadedmetadata', onLoaded);
  }, [videoUrl]);

  return (
    <div className="video-wrap card">
      {videoUrl ? (
        <>
          <video
            ref={videoRef}
            src={videoUrl}
            controls
            style={{ width: '100%' }}
          />
          <div className="timeline">
            <div className="bar" />
            {(markers || []).map((m) => (
              <div
                key={m.det_id}
                className="marker"
                title={m.label}
                style={{ left: `${m.pct * 100}%` }}
                onClick={() => {
                  if (duration && videoRef.current) {
                    videoRef.current.currentTime = m.pct * duration;
                  }
                }}
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
