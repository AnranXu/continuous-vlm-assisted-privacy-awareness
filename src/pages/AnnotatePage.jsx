// src/pages/AnnotatePage.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import { readAssignment, presign, saveProgress } from '../api';
import VideoPlayerWithMarkers from '../components/VideoPlayerWithMarkers';
import ThreatList from '../components/ThreatList';
import AnnotationForm from '../components/AnnotationForm';

export default function AnnotatePage() {
  const navigate = useNavigate();
  const st = useStore();
  const [loading, setLoading] = useState(false);
  const [accepted, setAccepted] = useState({});
  const [manualDetections, setManualDetections] = useState([]);
  const [urlMode] = useState(() => {
    if (typeof window === 'undefined') return null;
    const params = new URLSearchParams(window.location.search);
    const modeParam = params.get('mode');
    return modeParam ? modeParam.toLowerCase() : null;
  });
  const normalizedMode = (
    urlMode ||
    st.assignment?.mode ||
    st.assignment?.assigned_mode ||
    'normal'
  ).toLowerCase();
  const isTestMode = normalizedMode === 'test';

  // If VLM-assisted, fetch VLM detection JSON when necessary
  const [vlmJson, setVlmJson] = useState(null);

  useEffect(() => {
    async function loadVlm() {
      if (st.assignedMode !== 'vlm') return;
      if (!st.assignment || !st.assignment.assets?.vlmUrl) return;
      try {
        const res = await fetch(st.assignment.assets.vlmUrl);
        if (res.ok) {
          const data = await res.json();
          setVlmJson(data);
        }
      } catch (e) {
        console.error('Failed to load VLM detections', e);
      }
    }
    loadVlm();
  }, [st.assignment, st.assignedMode]);

  // Map detections to timeline markers
  const markers = useMemo(() => {
    if (st.assignedMode !== 'vlm' || !vlmJson) return [];
    const dur = vlmJson.duration_sec || 1;
    const mapAnchor = (a) =>
      a === 'beginning' ? 0.1 :
      a === 'middle' ? 0.5 :
      a === 'end' ? 0.9 :
      a === 'throughout' ? 0.5 : 0.5;

    return (vlmJson.detections || []).map(d => ({
      det_id: d.det_id,
      pct: d.time_sec != null ? Math.min(1, Math.max(0, d.time_sec / dur)) : mapAnchor(d.temporal_anchor),
      label: d.detected_visual
    }));
  }, [vlmJson, st.assignedMode]);

  async function handleSave() {
    if (!st.assignment) {
      alert('No assignment loaded');
      return;
    }
    try {
      setLoading(true);
      const mode = st.assignedMode;
      const clipIndex = st.currentClipIndex;
      const ann = {
        participant_id: st.participantId,
        story_id: st.storyId,
        clip_index: clipIndex,
        mode,
        accepted_vlm_detections: Object.entries(accepted)
          .filter(([_, v]) => v)
          .map(([id]) => id),
        manual_detections: manualDetections,
        ratings: {
          workload: null,
          trust_ai: null,
          share_willingness: null,
        },
        submitted_at: new Date().toISOString(),
      };

      const key = `participants/${st.participantId}/annotations/${st.storyId}/clip_${clipIndex}.json`;
      const { url } = await presign(key, 'PUT', 'application/json');
      await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ann),
      });

      // update assignment locally + on server
      const updated = { ...st.assignment };
      const pi = updated.progress;
      pi.annotations_index = pi.annotations_index || {};
      pi.annotations_index[String(clipIndex)] = key;
      if (!pi.completed_clip_indices.includes(clipIndex)) {
        pi.completed_clip_indices.push(clipIndex);
      }
      if (clipIndex < pi.total_clips) {
        pi.current_clip_index = clipIndex + 1;
      } else {
        // finished all clips: mark as beyond total
        pi.current_clip_index = pi.total_clips + 1;
      }

      await saveProgress(st.participantId, updated);
      st.setState({ assignment: updated });
      alert('Saved.');
    } catch (e) {
      console.error(e);
      alert('Failed to save. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function handleNextClip() {
    if (!st.participantId) {
      navigate('/');
      return;
    }
    const { assignment, assets } = await readAssignment(st.participantId);
    const pi = assignment.progress;

    if (pi.current_clip_index > pi.total_clips) {
      // go to complete page
      st.setState({ assignment });
      navigate('/complete');
      return;
    }

    st.setState({
      assignment,
      currentClipIndex: pi.current_clip_index,
      videoUrl: assets.videoUrl,
      vlmDetections: assets.vlmDetections || null,
    });
    setAccepted({});
    setManualDetections([]);
    window.scrollTo(0, 0);
  }

  return (
    <div className="container">
      <div className="header">
        <h2>
          Clip {st.currentClipIndex} / {st.totalClips || '?'}
        </h2>
        <details>
          <summary>Show instructions</summary>
          <p>
            Watch the clip and identify any moments or objects that could be privacy-sensitive.
            If the AI suggests threats (VLM mode), you can accept them or add your own.
          </p>
        </details>
      </div>

      <VideoPlayerWithMarkers
        videoUrl={st.videoUrl}
        markers={markers}
        allowForwardSeek={isTestMode}
        pauseWhenInactive={!isTestMode}
      />

      {st.assignedMode === 'vlm' && vlmJson && (
        <ThreatList
          detections={vlmJson.detections || []}
          accepted={accepted}
          onToggle={(id, val) => setAccepted((prev) => ({ ...prev, [id]: val }))}
        />
      )}

      <AnnotationForm
        onAdd={(d) =>
          setManualDetections((prev) => [...prev, d])
        }
      />

      <div className="row">
        <button onClick={handleSave} disabled={loading}>
          Save
        </button>
        <button onClick={handleNextClip} disabled={loading}>
          Next Clip
        </button>
      </div>
    </div>
  );
}
