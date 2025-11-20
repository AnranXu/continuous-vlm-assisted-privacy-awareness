// src/components/AnnotationForm.jsx
import React, { useState } from 'react';

const INFO_TYPES = [
  'personal information',
  'location of shooting',
  'individual preferences/pastimes',
  'social circle',
  'others’ private/confidential',
];

const STAKEHOLDERS = ['wearer', 'bystander', 'third_party'];
const { storyAnalysis, currentClipIndex } = useStore();

const clipData = storyAnalysis?.clips.find(
  (c) => c.clip_index === currentClipIndex
);

// for markers:
const detections = clipData?.detections || [];
const duration = clipData?.duration_sec || null;

export default function AnnotationForm({ onAdd }) {
  const [form, setForm] = useState({
    det_id: `m_${Date.now()}`,
    time_sec: '',
    temporal_anchor: 'uncertain',
    scene_anchor: '',
    detected_visual: '',
    why_privacy_sensitive: '',
    stakeholders: [],
    information_types: [],
    severity: 1,
    confidence: 'medium',
  });

  function update(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function toggleArray(key, value) {
    setForm((prev) => {
      const set = new Set(prev[key]);
      set.has(value) ? set.delete(value) : set.add(value);
      return { ...prev, [key]: Array.from(set) };
    });
  }

  function handleSubmit() {
    if (!form.detected_visual.trim()) {
      alert('Please describe what you saw.');
      return;
    }
    const out = {
      ...form,
      time_sec: form.time_sec === '' ? null : Number(form.time_sec),
    };
    onAdd(out);
    setForm((prev) => ({
      ...prev,
      det_id: `m_${Date.now()}`,
      time_sec: '',
      scene_anchor: '',
      detected_visual: '',
      why_privacy_sensitive: '',
      stakeholders: [],
      information_types: [],
      severity: 1,
      confidence: 'medium',
    }));
  }

  return (
    <div className="card">
      <h3>Your own privacy detections</h3>
      <div className="grid">
        <label>
          Time (seconds, optional)
          <input
            type="number"
            value={form.time_sec}
            onChange={(e) => update('time_sec', e.target.value)}
          />
        </label>
        <label>
          Temporal anchor
          <select
            value={form.temporal_anchor}
            onChange={(e) => update('temporal_anchor', e.target.value)}
          >
            <option>beginning</option>
            <option>middle</option>
            <option>end</option>
            <option>throughout</option>
            <option>uncertain</option>
          </select>
        </label>
        <label>
          Scene anchor
          <input
            value={form.scene_anchor}
            onChange={(e) => update('scene_anchor', e.target.value)}
            placeholder="e.g., kitchen sink, store counter"
          />
        </label>
      </div>

      <label>
        What is visible? (describe briefly)
        <textarea
          value={form.detected_visual}
          onChange={(e) => update('detected_visual', e.target.value)}
        />
      </label>

      <label>
        Why is it privacy-sensitive?
        <textarea
          value={form.why_privacy_sensitive}
          onChange={(e) => update('why_privacy_sensitive', e.target.value)}
        />
      </label>

      <div className="grid">
        <fieldset>
          <legend>Stakeholders</legend>
          {STAKEHOLDERS.map((s) => (
            <label key={s}>
              <input
                type="checkbox"
                checked={form.stakeholders.includes(s)}
                onChange={() => toggleArray('stakeholders', s)}
              />
              {s}
            </label>
          ))}
        </fieldset>

        <fieldset>
          <legend>Information types</legend>
          {INFO_TYPES.map((t) => (
            <label key={t}>
              <input
                type="checkbox"
                checked={form.information_types.includes(t)}
                onChange={() => toggleArray('information_types', t)}
              />
              {t}
            </label>
          ))}
        </fieldset>

        <label>
          Severity
          <select
            value={form.severity}
            onChange={(e) => update('severity', Number(e.target.value))}
          >
            <option value={0}>0 (none)</option>
            <option value={1}>1 (low)</option>
            <option value={2}>2 (medium)</option>
            <option value={3}>3 (high)</option>
          </select>
        </label>
        <label>
          Confidence
          <select
            value={form.confidence}
            onChange={(e) => update('confidence', e.target.value)}
          >
            <option>low</option>
            <option>medium</option>
            <option>high</option>
          </select>
        </label>
      </div>

      <button onClick={handleSubmit}>Add detection</button>
    </div>
  );
}
