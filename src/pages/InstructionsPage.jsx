// src/pages/InstructionsPage.jsx
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import { assignParticipant } from '../api';
import InstructionAccordion from '../components/InstructionAccordion';

export default function InstructionsPage() {
  const navigate = useNavigate();
  const { storyId, setState } = useStore();
  const [pid, setPid] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleStart() {
    if (!pid.trim()) {
      alert('Please enter your Prolific ID');
      return;
    }
    try {
      setLoading(true);
      const { assignment, assets } = await assignParticipant(pid.trim(), storyId);
      setState({
        participantId: pid.trim(),
        assignedMode: assignment.assigned_mode,
        storyId: assignment.story_id,
        totalClips: assignment.progress.total_clips,
        currentClipIndex: assignment.progress.current_clip_index,
        videoUrl: assets.videoUrl,
        vlmDetections: assets.vlmDetections || null,
        assignment,
        prolificCompletionUrl: assignment.prolific_completion_url || null,
      });
      navigate('/annotate');
    } catch (err) {
      console.error(err);
      alert('Failed to start/resume. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="container">
      <h1>Continuous VLM-assisted Privacy Awareness</h1>
      <InstructionAccordion />
      <div className="card">
        <label>Prolific ID</label>
        <input
          value={pid}
          onChange={(e) => setPid(e.target.value)}
          placeholder="Enter your Prolific ID"
        />
        <button onClick={handleStart} disabled={loading}>
          {loading ? 'Loading…' : 'Start / Resume Study'}
        </button>
      </div>
    </div>
  );
}
