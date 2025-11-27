// src/App.jsx
import { useEffect, useRef, useState } from "react";
import {
  assignParticipant,
  assignTestParticipant,
  presignGet,
  // markFinished,        // you can enable later when you wire it
} from "./api";
import InstructionsPage from "./components/InstructionsPage";
import TaskView from "./components/TaskView";

// ---------- URL PARAMS (parsed once at module load) ----------
const params = new URLSearchParams(window.location.search);

const urlMode = (params.get("mode") || "").toLowerCase(); // "test" or ""
const IS_TEST_MODE = urlMode === "test";

// "study" = which experimental condition we’re testing in test mode
//   ?study=human  → test human-only condition
//   ?study=VLM    → test VLM-assisted condition
const rawStudy = params.get("study");
const TEST_STUDY_MODE =
  rawStudy && rawStudy.toLowerCase() === "vlm"
    ? "vlm"
    : rawStudy && rawStudy.toLowerCase() === "human"
    ? "human"
    : null;

// "story" = 1-based index into study_config.stories[]
const TEST_STORY_INDEX = (() => {
  const s = params.get("story");
  const n = s ? parseInt(s, 10) : 1;
  return Number.isFinite(n) && n > 0 ? n : 1;
})();

// Optional participant injected via URL in test mode
const TEST_PARTICIPANT_FROM_URL = params.get("participant") || null;

function App() {
  const [prolificId, setProlificId] = useState("");
  const [assignment, setAssignment] = useState(null);
  const [storyConfig, setStoryConfig] = useState(null);

  const [currentClipIndex, setCurrentClipIndex] = useState(0); // 0-based
  const [videoUrl, setVideoUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  // placeholder annotation text
  const [annotationText, setAnnotationText] = useState("");
  const [clipCompletion, setClipCompletion] = useState({});
  const [awaitingVlmInstruction, setAwaitingVlmInstruction] = useState(false);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [helpSlide, setHelpSlide] = useState(0);
  const [showVlmInfoModal, setShowVlmInfoModal] = useState(false);
  const [vlmAnalysis, setVlmAnalysis] = useState(null);

  const videoRef = useRef(null);
  const furthestTimeRef = useRef(0);
  const FORWARD_HEADROOM = 0.8; // seconds participants can scrub ahead of watched time

  const helpSlides = [
    "You will watch short, first-person video clips and imagine they reflect your own daily activities.",
    "Identify parts of each video you consider private, sensitive, or revealing and briefly explain why.",
    "There are no right or wrong answers—use your judgment about what feels privacy-relevant.",
  ];

  function clampToFurthest(videoEl) {
    if (!videoEl || IS_TEST_MODE) return;
    const allowed = furthestTimeRef.current + FORWARD_HEADROOM;
    if (videoEl.currentTime > allowed) {
      videoEl.currentTime = allowed;
    }
  }

  // ---------- Helpers ----------

  function resolvedParticipantId() {
    const trimmed = prolificId.trim();
    if (trimmed) return trimmed;
    if (IS_TEST_MODE && TEST_PARTICIPANT_FROM_URL) return TEST_PARTICIPANT_FROM_URL;
    return "";
  }

  async function loadClipByIndex(idx, cfg) {
    if (!cfg) cfg = storyConfig;
    if (!cfg || !cfg.clips || !cfg.clips[idx]) {
      throw new Error("Invalid clip index");
    }
    const clip = cfg.clips[idx];
    const url = await presignGet(clip.video_key);
    setVideoUrl(url);
    setCurrentClipIndex(idx);
    furthestTimeRef.current = 0;
    if (videoRef.current) {
      videoRef.current.currentTime = 0;
    }
  }

  async function loadStoryConfig(storyId, modeHint) {
    const configKey = `stories/${storyId}/config.json`;
    const configUrl = await presignGet(configKey);

    const res = await fetch(configUrl);
    if (!res.ok) {
      throw new Error(`Failed to load story config: ${res.status}`);
    }
    const cfg = await res.json();
    setStoryConfig(cfg);
    setVlmAnalysis(null);

    if (!cfg.clips || cfg.clips.length === 0) {
      throw new Error("Story config has no clips.");
    }
    if ((modeHint || assignment?.mode) === "vlm") {
      try {
        if (cfg.analysis_key) {
          const analysisUrl = await presignGet(cfg.analysis_key);
          const aRes = await fetch(analysisUrl);
          if (aRes.ok) {
            const data = await aRes.json();
            setVlmAnalysis(data);
          } else {
            console.error("Failed to fetch analysis JSON", aRes.status);
          }
        }
      } catch (err) {
        console.error("Analysis load error", err);
      }
    }
    await loadClipByIndex(0, cfg);
  }

  // ---------- Start button ----------

  async function handleStart(e) {
    e.preventDefault();
    setError("");
    setStatus("");
    setAssignment(null);
    setStoryConfig(null);
    setVideoUrl("");
    setCurrentClipIndex(0);
    setAnnotationText("");
    setClipCompletion({});
    setAwaitingVlmInstruction(false);
    setShowVlmInfoModal(false);

    const pid = resolvedParticipantId();
    if (!pid) {
      setError("Please enter your Prolific ID.");
      return;
    }

    setLoading(true);
    try {
      let assignRes;

      if (IS_TEST_MODE && TEST_STUDY_MODE) {
        // ---------- TEST MODE ----------
        setStatus(
          `Test mode: story index ${TEST_STORY_INDEX}, condition=${TEST_STUDY_MODE}`
        );
        assignRes = await assignTestParticipant({
          participantId: pid,
          storyIndex: TEST_STORY_INDEX,
          mode: TEST_STUDY_MODE, // "human" or "vlm"
        });
      } else {
        // ---------- NORMAL STUDY MODE ----------
        assignRes = await assignParticipant(pid);
      }

      setAssignment(assignRes);
      if (assignRes.mode === "vlm") {
        setAwaitingVlmInstruction(true);
        setShowVlmInfoModal(true);
      }
      await loadStoryConfig(assignRes.storyId, assignRes.mode);
    } catch (err) {
      console.error(err);
      setError(err.message || "Unknown error during assignment.");
    } finally {
      setLoading(false);
    }
  }

  // ---------- Navigation between clips ----------

  async function handleNextClip() {
    if (!storyConfig) return;
    if (!IS_TEST_MODE && !clipCompletion[currentClipIndex]) {
      setStatus("Finish this scenario to unlock Next.");
      return;
    }
    const next = currentClipIndex + 1;
    if (next >= storyConfig.clips.length) return;
    setLoading(true);
    setError("");
    try {
      await loadClipByIndex(next);
      setAnnotationText("");
    } catch (err) {
      console.error(err);
      setError(err.message || "Failed to load next clip.");
    } finally {
      setLoading(false);
    }
  }

  async function handlePrevClip() {
    if (!storyConfig) return;
    const prev = currentClipIndex - 1;
    if (prev < 0) return;
    setLoading(true);
    setError("");
    try {
      await loadClipByIndex(prev);
      setAnnotationText("");
    } catch (err) {
      console.error(err);
      setError(err.message || "Failed to load previous clip.");
    } finally {
      setLoading(false);
    }
  }

  // ---------- Placeholder annotation save ----------

  function handleSaveAnnotation() {
    // For now just log; later you will hook up presignPut & upload to S3.
    console.log("ANNOTATION (placeholder):", {
      participantId: resolvedParticipantId(),
      assignment,
      currentClipIndex,
      text: annotationText,
    });
    setStatus("Annotation saved (placeholder only).");
  }

  // ---------- UI ----------

  const hasActiveTask = Boolean(assignment && storyConfig);

  const pageTitle = (() => {
    if (!hasActiveTask) {
      return "Privacy Perception in Visual Content Understanding (30-45 minutes)";
    }
    const mode = (assignment?.mode || "").toLowerCase();
    return mode === "vlm"
      ? "AI-assisted identification of privacy threats in egocentric videos"
      : "Identify privacy threats in egocentric videos";
  })();

  const renderFeedback = (opts = { showStatus: true }) => (
    <>
      {error && <div style={{ color: "red", marginTop: "12px" }}>{error}</div>}
      {opts.showStatus && status && !error && (
        <div
          style={{
            color: "#1d4ed8",
            background: "#e0e7ff",
            border: "1px solid #bfdbfe",
            padding: "8px 10px",
            borderRadius: "8px",
            marginTop: "10px",
          }}
        >
          {status}
        </div>
      )}
    </>
  );

  const testBanner =
    IS_TEST_MODE && (
      <div
        style={{
          padding: "8px 12px",
          marginBottom: "12px",
          borderRadius: "8px",
          background: "#ffe9b5",
          color: "#7a4b00",
          fontSize: "0.9rem",
        }}
      >
        TEST MODE ACTIVE – URL params:&nbsp;
        <code>
          study={rawStudy || "(none)"}&nbsp; story={params.get("story") || "1"}
        </code>
      </div>
    );

  useEffect(() => {
    if (!assignment) return;
    const pid = resolvedParticipantId() || "(unknown)";
    const story = assignment.storyId || "(no story)";
    const mode = assignment.mode || assignment.assigned_mode || "(unknown mode)";
    console.info("Study session context:", { story, mode, participantId: pid });
  }, [assignment]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      style={{
        maxWidth: "1280px",
        margin: "0 auto",
        padding: "24px 16px 40px",
        fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
      }}
    >
      {hasActiveTask && (
        <h1 style={{ fontSize: "2rem", marginBottom: "8px" }}>{pageTitle}</h1>
      )}
      {testBanner}

      {!hasActiveTask && (
        <InstructionsPage
          prolificId={prolificId}
          loading={loading}
          onChange={(e) => setProlificId(e.target.value)}
          onSubmit={handleStart}
          placeholder={
            IS_TEST_MODE && TEST_PARTICIPANT_FROM_URL
              ? `Optional (default: ${TEST_PARTICIPANT_FROM_URL})`
              : "Enter your Prolific ID"
          }
          feedback={renderFeedback({ showStatus: true })}
        />
      )}

      {/* Main task area */}
      {hasActiveTask && (
        <TaskView
          assignment={assignment}
          storyConfig={storyConfig}
          currentClipIndex={currentClipIndex}
          videoUrl={videoUrl}
          loading={loading}
          clipCompletion={clipCompletion}
          setClipCompletion={setClipCompletion}
          isTestMode={IS_TEST_MODE}
          handlePrevClip={handlePrevClip}
          handleNextClip={handleNextClip}
          renderFeedback={renderFeedback}
          annotationText={annotationText}
          setAnnotationText={setAnnotationText}
          handleSaveAnnotation={handleSaveAnnotation}
          helpSlides={helpSlides}
          showHelpModal={showHelpModal}
          setShowHelpModal={setShowHelpModal}
          helpSlide={helpSlide}
          setHelpSlide={setHelpSlide}
          showVlmInfoModal={showVlmInfoModal}
          setShowVlmInfoModal={setShowVlmInfoModal}
          setAwaitingVlmInstruction={setAwaitingVlmInstruction}
          videoRef={videoRef}
          clampToFurthest={clampToFurthest}
          furthestTimeRef={furthestTimeRef}
          vlmAnalysis={vlmAnalysis}
        />
      )}

      {showHelpModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            zIndex: 50,
          }}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: "12px",
              padding: "16px",
              width: "min(600px, 90vw)",
              boxShadow: "0 20px 50px rgba(0,0,0,0.25)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ margin: 0 }}>Instructions</h3>
              <button
                onClick={() => setShowHelpModal(false)}
                style={{
                  border: "none",
                  background: "transparent",
                  fontSize: "1.2rem",
                  cursor: "pointer",
                  padding: "4px 8px",
                  lineHeight: 1,
                  color: "#0f172a",
                }}
                aria-label="Close instructions"
              >
                ×
              </button>
            </div>
            <p style={{ marginTop: "12px", marginBottom: "8px" }}>
              {helpSlides[helpSlide]}
            </p>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginTop: "12px" }}>
              <input
                type="range"
                min={0}
                max={helpSlides.length - 1}
                value={helpSlide}
                onChange={(e) => setHelpSlide(parseInt(e.target.value, 10))}
                style={{ flex: 1 }}
              />
              <span>
                {helpSlide + 1} / {helpSlides.length}
              </span>
            </div>
          </div>
        </div>
      )}

      {showVlmInfoModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.55)",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            zIndex: 50,
          }}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: "12px",
              padding: "18px",
              width: "min(640px, 92vw)",
              boxShadow: "0 20px 50px rgba(0,0,0,0.3)",
              lineHeight: 1.5,
              color: "#0f172a",
            }}
          >
            <h3 style={{ marginTop: 0 }}>AI-assisted mode</h3>
            <p>
              In this version of the task, you will receive automated suggestions generated by an AI system that
              analyzes the video frames. The AI may highlight moments or visual details that could potentially be
              sensitive.
            </p>
            <p style={{ marginBottom: "8px" }}>Your role is to:</p>
            <ul>
              <li>Review the AI’s suggestions.</li>
              <li>Correct them if needed.</li>
              <li>Add any privacy-sensitive moments the AI may have missed.</li>
            </ul>
            <p>
              The AI suggestions are not always complete or accurate — your own judgment is essential. Please take your
              time and provide your own input in addition to reviewing the AI’s output. Your feedback will help us
              understand how people interact with automated assistance when reasoning about privacy.
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
              <button
                onClick={() => {
                  setShowVlmInfoModal(false);
                  setAwaitingVlmInstruction(false);
                }}
                style={{
                  padding: "8px 14px",
                  borderRadius: "8px",
                  border: "1px solid #1d4ed8",
                  background: "#1d4ed8",
                  color: "#fff",
                  cursor: "pointer",
                  fontWeight: 600,
                }}
                aria-label="Close AI assistance info"
              >
                Got it
              </button>
              <button
                onClick={() => {
                  setShowVlmInfoModal(false);
                  setAwaitingVlmInstruction(false);
                }}
                style={{
                  padding: "6px 10px",
                  borderRadius: "8px",
                  border: "1px solid #cbd5e1",
                  background: "#fff",
                  cursor: "pointer",
                  color: "#0f172a",
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
