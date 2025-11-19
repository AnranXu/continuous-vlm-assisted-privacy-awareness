// src/components/ThreatList.jsx
import React from 'react';

export default function ThreatList({ detections, accepted, onToggle }) {
  if (!detections.length) return null;
  return (
    <div className="card">
      <h3>AI-suggested privacy threats</h3>
      <ul className="threats">
        {detections.map((d) => (
          <li key={d.det_id} className="threat">
            <label>
              <input
                type="checkbox"
                checked={!!accepted[d.det_id]}
                onChange={(e) => onToggle(d.det_id, e.target.checked)}
              />
              <strong>{d.detected_visual}</strong>{' '}
              <small>
                {d.information_types && d.information_types.join(', ')}
              </small>
            </label>
            <div className="muted">{d.why_privacy_sensitive}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}
