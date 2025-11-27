// src/App.jsx
import { useEffect, useRef, useState } from "react";
import {
  assignParticipant,
  assignTestParticipant,
  presignGet,
  // markFinished,        // you can enable later when you wire it
} from "./api";
import InstructionsPage from "./components/InstructionsPage";

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

  async function loadStoryConfig(storyId) {
    const configKey = `stories/${storyId}/config.json`;
    const configUrl = await presignGet(configKey);

    const res = await fetch(configUrl);
    if (!res.ok) {
      throw new Error(`Failed to load story config: ${res.status}`);
    }
    const cfg = await res.json();
    setStoryConfig(cfg);

    if (!cfg.clips || cfg.clips.length === 0) {
      throw new Error("Story config has no clips.");
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
      await loadStoryConfig(assignRes.storyId);
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
        maxWidth: "960px",
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
        <div>
          <div style={{ marginBottom: "10px" }}>
            <h2
              style={{
                fontSize: "2rem",
                margin: 0,
                fontWeight: 800,
                display: "flex",
                alignItems: "center",
                gap: "10px",
                flexWrap: "wrap",
                paddingLeft: "12px",
              }}
            >
              {IS_TEST_MODE ? (
                <>
                  Story: {assignment.storyId}
                  {assignment.mode && (
                    <span style={{ fontSize: "1rem", fontWeight: "normal" }}>
                      ({assignment.mode})
                    </span>
                  )}
                </>
              ) : (
                <>
                  Now Viewing Scenario{" "}
                  <span style={{ color: "#1d4ed8" }}>
                    {currentClipIndex + 1}
                  </span>{" "}
                  of{" "}
                  <span style={{ color: "#0ea5e9" }}>
                    {storyConfig.clips.length}
                  </span>
                </>
              )}
            </h2>
          </div>

          <div
            style={{
              marginBottom: "12px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "12px",
              flexWrap: "wrap",
            }}
          >
            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => {
                  setShowHelpModal(true);
                  setHelpSlide(0);
                }}
                style={{
                  padding: "8px 12px",
                  borderRadius: "10px",
                  border: "1px solid #cbd5e1",
                  background: "#fff",
                  cursor: "pointer",
                  color: "#0f172a",
                }}
              >
                View instructions
              </button>
              {assignment?.mode === "vlm" && (
                <button
                  type="button"
                  onClick={() => {
                    setShowVlmInfoModal(true);
                    setAwaitingVlmInstruction(false);
                  }}
                  style={{
                    padding: "8px 12px",
                    borderRadius: "10px",
                    border: "1px solid #cbd5e1",
                    background: "#fff",
                    cursor: "pointer",
                    color: "#0f172a",
                  }}
                >
                  AI assistance info
                </button>
              )}
            </div>

            <div
              style={{
                display: "flex",
                gap: "12px",
                alignItems: "center",
                flexWrap: "wrap",
              }}
            >
              <button
                type="button"
                onClick={handlePrevClip}
                disabled={currentClipIndex === 0 || loading}
                style={{
                  padding: "10px 14px",
                  borderRadius: "10px",
                  border: "1px solid",
                  borderColor:
                    currentClipIndex === 0 || loading ? "#cbd5e1" : "#1d4ed8",
                  background:
                    currentClipIndex === 0 || loading ? "#e2e8f0" : "#1d4ed8",
                  color:
                    currentClipIndex === 0 || loading ? "#475569" : "#fff",
                  fontWeight: 700,
                  boxShadow:
                    currentClipIndex === 0 || loading
                      ? "none"
                      : "0 8px 16px rgba(37, 99, 235, 0.25)",
                  cursor:
                    currentClipIndex === 0 || loading ? "default" : "pointer",
                }}
              >
                Previous clip
              </button>
              <button
                type="button"
                onClick={handleNextClip}
                disabled={
                  !storyConfig ||
                  currentClipIndex >= storyConfig.clips.length - 1 ||
                  loading ||
                  (!IS_TEST_MODE && !clipCompletion[currentClipIndex])
                }
                style={{
                  padding: "10px 14px",
                  borderRadius: "10px",
                  border: "1px solid",
                  borderColor:
                    !storyConfig ||
                    currentClipIndex >= storyConfig.clips.length - 1 ||
                    loading
                      ? "#cbd5e1"
                      : "#1d4ed8",
                  background:
                    !storyConfig ||
                    currentClipIndex >= storyConfig.clips.length - 1 ||
                    loading
                      ? "#e2e8f0"
                      : "#1d4ed8",
                  color:
                    !storyConfig ||
                    currentClipIndex >= storyConfig.clips.length - 1 ||
                    loading
                      ? "#475569"
                      : "#fff",
                  fontWeight: 700,
                  boxShadow:
                    !storyConfig ||
                    currentClipIndex >= storyConfig.clips.length - 1 ||
                    loading
                      ? "none"
                      : "0 8px 16px rgba(37, 99, 235, 0.25)",
                  cursor:
                    !storyConfig ||
                    currentClipIndex >= storyConfig.clips.length - 1 ||
                    loading
                      ? "default"
                      : "pointer",
                }}
              >
                Next clip
              </button>
              {!IS_TEST_MODE && !clipCompletion[currentClipIndex] && (
                <div style={{ color: "#b45309", fontSize: "0.95rem" }}>
                  Finish watching this scenario to unlock Next.
                </div>
              )}
            </div>
          </div>

          {/* Video player */}
          <div
            style={{
              marginBottom: "12px",
              background: "#000",
              borderRadius: "8px",
              overflow: "hidden",
            }}
          >
            {videoUrl ? (
              <video
                key={videoUrl}
                ref={videoRef}
                src={videoUrl}
                controls
                onTimeUpdate={(e) => {
                  if (IS_TEST_MODE) return;
                  const t = e.target.currentTime;
                  const allowed = furthestTimeRef.current + FORWARD_HEADROOM;
                  if (t > allowed) {
                    clampToFurthest(e.target);
                    return;
                  }
                  if (t > furthestTimeRef.current) {
                    furthestTimeRef.current = t;
                  }
                }}
                onSeeking={(e) => {
                  if (IS_TEST_MODE) return;
                  clampToFurthest(e.target);
                }}
                onPlay={(e) => clampToFurthest(e.target)}
                onEnded={() => {
                  setClipCompletion((prev) => ({
                    ...prev,
                    [currentClipIndex]: true,
                  }));
                  if (!IS_TEST_MODE) {
                    furthestTimeRef.current = videoRef.current?.duration || furthestTimeRef.current;
                  }
                }}
                style={{ width: "100%", display: "block" }}
              />
            ) : (
              <div
                style={{
                  padding: "40px",
                  textAlign: "center",
                  color: "#fff",
                }}
              >
                Loading video...
              </div>
            )}
          </div>

          {/* Annotation placeholder */}
          {renderFeedback({ showStatus: !IS_TEST_MODE })}
          <div
            style={{
              border: "1px solid #ddd",
              borderRadius: "10px",
              padding: "12px",
            }}
          >
            <h3
              style={{
                fontSize: "1.1rem",
                marginBottom: "8px",
              }}
            >
              Annotation (placeholder)
            </h3>
            <p style={{ fontSize: "0.9rem", marginBottom: "8px" }}>
              Please type anything here to simulate your annotation. In the real
              study this will be replaced with the privacy-threat questions and
              S3 upload logic.
            </p>
            <textarea
              rows={4}
              value={annotationText}
              onChange={(e) => setAnnotationText(e.target.value)}
              style={{
                width: "100%",
                padding: "8px",
                borderRadius: "8px",
                border: "1px solid #ccc",
                marginBottom: "8px",
              }}
            />
            <button
              type="button"
              onClick={handleSaveAnnotation}
              disabled={loading}
              style={{
                padding: "6px 14px",
                borderRadius: "6px",
                border: "none",
                background: "#10b981",
                color: "#fff",
                fontWeight: 600,
                cursor: loading ? "default" : "pointer",
              }}
            >
              Save annotation (placeholder)
            </button>
          </div>
        </div>
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
