// src/pages/InstructionsPage.jsx
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import { assignParticipant } from '../api';

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
      <h1>Privacy Perception in Continuous Vision-language Model Interactions (30-45 minutes)</h1>

      <div className="card">
        <p>
          <strong>Lead Researcher:</strong> Anran Xu, Ph.D. (AI Safety Researcher at RIKEN in Japan)
          <br />
          <strong>Contact:</strong> anran.xu@riken.jp
        </p>
        <p>
          Hi there! You are invited to help with a research study about privacy and artificial intelligence (AI).
          Please read this page before you decide to join.
        </p>

        <h3>What is this study about?</h3>
        <p>
          Imagine you have an AI assistant (like in smart glasses) that can see what you see and talk to you.
          We want to know how you would feel about privacy if you used an AI like this every day. Sometimes,
          an AI might learn sensitive things about you by combining small bits of info over time. For example,
          by seeing your kitchen, your commute, and your office, it might figure out where you live and work.
          We want to understand what you feel is private to you.
        </p>
        <p>Your feedback will help us build safer AI that respects everyone&apos;s privacy.</p>

        <h3>What will I have to do?</h3>
        <p>The task is straightforward and should take about 30-45 minutes:</p>
        <ul>
          <li>Watch short, first-person video clips from a public research collection.</li>
          <li>Pretend the videos are about your life, recorded by your own AI assistant.</li>
          <li>
            Point out and describe any moments or information that feel private or sensitive to you and any
            other stakeholders.
          </li>
          <li>
            AI helps: You may be assisted by an advanced AI model. If not, that is expected for this study condition.
          </li>
        </ul>

        <h3>Are there any risks?</h3>
        <p>
          There are no major risks. The videos show everyday scenes, but thinking about privacy might feel
          uncomfortable. You are free to skip any question that feels that way.
        </p>

        <h3>Benefit</h3>
        <p>
          You will be paid for your time as shown on Prolific. Your contribution will help design safer, more
          privacy-aware AI systems.
        </p>

        <h3>How is my privacy protected?</h3>
        <ul>
          <li>We never see your real name or Prolific details; Prolific keeps this anonymous.</li>
          <li>We only get your Prolific ID so we can pay you.</li>
          <li>
            We ask for general info (age, gender, nationality), kept separate from answers and only used for
            statistics.
          </li>
          <li>Your annotations will be processed and open-sourced when this project is published.</li>
          <li>Please provide answers anonymously.</li>
          <li>Your participation is voluntary. You can refuse or stop at any time.</li>
        </ul>

        <h3>Questions?</h3>
        <p>
          Contact Anran Xu at <a href="mailto:anran.xu@riken.jp">anran.xu@riken.jp</a> or message via Prolific.
        </p>
        <p>
          <strong>For complaints:</strong> RIKEN Safety Management Division Bioethics Section<br />
          050-3500-7242<br />
          human@riken.jp
        </p>
      </div>

      <div className="card">
        <label>Prolific ID</label>
        <input
          value={pid}
          onChange={(e) => setPid(e.target.value)}
          placeholder="Enter your Prolific ID"
        />
        <button onClick={handleStart} disabled={loading}>
          {loading ? 'Loading...' : 'Start / Resume Study'}
        </button>
      </div>
    </div>
  );
}
