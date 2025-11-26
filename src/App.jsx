// src/App.jsx
import { useEffect, useState } from "react";
import {
  assignParticipant,
  assignTestParticipant,
  presignGet,
  // markFinished,        // you can enable later when you wire it
} from "./api";

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
    setStatus(`Loaded clip ${idx + 1} / ${cfg.clips.length}`);
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

  const feedback = (
    <>
      {error && <div style={{ color: "red", marginTop: "12px" }}>{error}</div>}
      {status && !error && (
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

  return (
    <div
      style={{
        maxWidth: "960px",
        margin: "0 auto",
        padding: "24px 16px 40px",
        fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
      }}
    >
      <h1 style={{ fontSize: "2rem", marginBottom: "8px" }}>
        Continuous VLM-assisted Privacy Awareness
      </h1>
      {testBanner}

      {!hasActiveTask && (
        <>
          <p style={{ marginBottom: "24px", lineHeight: 1.4 }}>
            Please enter your <strong>Prolific ID</strong> to start the task.
            You will be assigned one egocentric video story and asked to review
            each clip with a simple annotation step (placeholder for now).
          </p>

          <form
            onSubmit={handleStart}
            style={{
              border: "1px solid #ddd",
              borderRadius: "12px",
              padding: "16px",
              marginBottom: "20px",
              background: "#fff",
              boxShadow: "0 10px 30px rgba(15, 23, 42, 0.05)",
            }}
          >
            <label
              htmlFor="prolificId"
              style={{ display: "block", fontWeight: 600, marginBottom: "8px" }}
            >
              Prolific ID:
            </label>
            <input
              id="prolificId"
              type="text"
              value={prolificId}
              onChange={(e) => setProlificId(e.target.value)}
              placeholder={
                IS_TEST_MODE && TEST_PARTICIPANT_FROM_URL
                  ? `Optional (default: ${TEST_PARTICIPANT_FROM_URL})`
                  : "Enter your Prolific ID"
              }
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: "10px",
                border: "1px solid #cbd5e1",
                marginBottom: "14px",
                fontSize: "1rem",
              }}
            />

            <button
              type="submit"
              disabled={loading}
              style={{
                padding: "10px 18px",
                borderRadius: "10px",
                border: "none",
                background: loading ? "#94a3b8" : "#2563eb",
                color: "white",
                fontWeight: 700,
                cursor: loading ? "default" : "pointer",
                boxShadow: loading
                  ? "none"
                  : "0 10px 18px rgba(37, 99, 235, 0.2)",
              }}
            >
              {loading ? "Starting..." : "Start"}
            </button>

            {feedback}
          </form>
        </>
      )}

      {/* Main task area */}
      {hasActiveTask && (
        <div>
          <h2 style={{ fontSize: "1.4rem", marginBottom: "8px" }}>
            Story: {assignment.storyId}
            {IS_TEST_MODE && assignment.mode && (
              <>
                {" "}
                <span style={{ fontSize: "0.9rem", fontWeight: "normal" }}>
                  ({assignment.mode})
                </span>
              </>
            )}
          </h2>
          <p style={{ marginBottom: "12px" }}>
            Clip {currentClipIndex + 1} of {storyConfig.clips.length}
          </p>

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
                src={videoUrl}
                controls
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

          {/* Navigation buttons */}
          {feedback}
          <div
            style={{
              marginBottom: "18px",
              display: "flex",
              gap: "12px",
              alignItems: "center",
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
                loading
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
          </div>

          {/* Annotation placeholder */}
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
    </div>
  );
}

export default App;
