// src/App.jsx
import { useState, useEffect } from "react";
import {
  assignParticipant,
  presignGet,
  presignPut,
  markFinished
} from "./api";
import VideoPlayerWithMarkers from "./components/VideoPlayerWithMarkers";

function App() {
  const [participantId, setParticipantId] = useState("");
  const [assignment, setAssignment] = useState(null); // {participantId, storyId, mode, ...}
  const [storyConfig, setStoryConfig] = useState(null); // config.json content
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [currentClipIndex, setCurrentClipIndex] = useState(0); // 0-based index into config.clips
  const [videoUrl, setVideoUrl] = useState("");
  const [annotationText, setAnnotationText] = useState("");
  const [finished, setFinished] = useState(false);
  const [clipCompletion, setClipCompletion] = useState({});
  const [furthestClipUnlocked, setFurthestClipUnlocked] = useState(0);
  const [navNotice, setNavNotice] = useState("");
  const [urlMode] = useState(() => {
    if (typeof window === "undefined") return null;
    const params = new URLSearchParams(window.location.search);
    const modeParam = params.get("mode");
    return modeParam ? modeParam.toLowerCase() : null;
  });

  const hasTask = Boolean(assignment && storyConfig);
  const normalizedMode = (urlMode || assignment?.mode || "normal").toLowerCase();
  const isTestMode = normalizedMode === "test";

  async function handleStart(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    setFinished(false);
    setStoryConfig(null);
    setAssignment(null);
    setCurrentClipIndex(0);
    setVideoUrl("");
    setAnnotationText("");
    setClipCompletion({});
    setFurthestClipUnlocked(0);
    setNavNotice("");

    try {
      if (!participantId.trim()) {
        throw new Error("Please enter your Prolific ID.");
      }

      // 1. Assign participant -> {storyId, mode}
      const assignRes = await assignParticipant(participantId.trim());
      setAssignment(assignRes);

      // 2. Load story config via presigned GET
      const storyId = assignRes.storyId;
      const configKey = `stories/${storyId}/config.json`;
      const configUrl = await presignGet(configKey);

      const configRes = await fetch(configUrl);
      if (!configRes.ok) {
        throw new Error(`Failed to load story config: ${configRes.status}`);
      }
      const cfg = await configRes.json();
      setStoryConfig(cfg);

      // 3. Prepare first clip video
      if (cfg.clips && cfg.clips.length > 0) {
        const firstClip = cfg.clips[0];
        const clipUrl = await presignGet(firstClip.video_key);
        setVideoUrl(clipUrl);
      } else {
        throw new Error("Story config has no clips.");
      }
    } catch (err) {
      console.error(err);
      setError(err.message || "Unknown error.");
    } finally {
      setLoading(false);
    }
  }

  // Load video URL when currentClipIndex changes
  useEffect(() => {
    async function loadClipUrl() {
      if (!storyConfig || !storyConfig.clips) return;
      if (currentClipIndex < 0 || currentClipIndex >= storyConfig.clips.length)
        return;

      try {
        const clip = storyConfig.clips[currentClipIndex];
        const url = await presignGet(clip.video_key);
        setVideoUrl(url);
      } catch (err) {
        console.error(err);
        setError(err.message || "Failed to load clip video.");
      }
    }

    if (hasTask) {
      loadClipUrl();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentClipIndex]);

  useEffect(() => {
    setNavNotice("");
    setFurthestClipUnlocked((prev) => Math.max(prev, currentClipIndex));
  }, [currentClipIndex]);

  function handleClipFinished(index) {
    setClipCompletion((prev) => {
      if (prev[index]) return prev;
      return { ...prev, [index]: true };
    });
    setNavNotice("");
  }

  function handlePreviousClip() {
    if (currentClipIndex <= 0) return;
    setCurrentClipIndex((idx) => Math.max(0, idx - 1));
  }

  function handleNextClipNavigate() {
    if (!storyConfig || currentClipIndex >= storyConfig.clips.length - 1) return;
    const hasUnlockedForward = currentClipIndex < furthestClipUnlocked;
    const hasWatchedCurrent = Boolean(clipCompletion[currentClipIndex]);
    if (!isTestMode && !hasUnlockedForward && !hasWatchedCurrent) {
      setNavNotice("Finish this clip to unlock the next one.");
      return;
    }
    setNavNotice("");
    setCurrentClipIndex((idx) => Math.min(storyConfig.clips.length - 1, idx + 1));
  }


  async function handleSaveAndNext() {
    if (!assignment || !storyConfig) return;

    if (!isTestMode && !clipCompletion[currentClipIndex]) {
      setError("Please finish watching the current clip before saving and moving on.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const storyId = assignment.storyId;
      const clip = storyConfig.clips[currentClipIndex];
      const clipIndex = clip.clip_index ?? currentClipIndex + 1;
      const clipId = clip.clip_id ?? `clip_${String(clipIndex).padStart(2, "0")}`;

      // 1. Build annotation payload (placeholder structure)
      const annotationPayload = {
        participantId,
        studyId: assignment.studyId,
        storyId,
        mode: assignment.mode,
        clipIndex,
        clipId,
        annotationText,
        savedAt: new Date().toISOString()
      };

      // 2. Get presigned PUT URL
      const annotationKey = `participants/${participantId}/annotations/${storyId}/${clipId}.json`;
      const putUrl = await presignPut(annotationKey, "application/json");

      // 3. Upload to S3
      const putRes = await fetch(putUrl, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(annotationPayload)
      });

      if (!putRes.ok) {
        throw new Error(`Failed to upload annotation: ${putRes.status}`);
      }

      // 4. Move to next clip or finish
      const nextIndex = currentClipIndex + 1;
      setAnnotationText("");

      if (nextIndex < storyConfig.clips.length) {
        setCurrentClipIndex(nextIndex);
      } else {
        // All clips done -> mark finished
        await markFinished(participantId);
        setFinished(true);
      }
    } catch (err) {
      console.error(err);
      setError(err.message || "Failed to save annotation.");
    } finally {
      setLoading(false);
    }
  }

  function renderIntro() {
    return (
      <div className="card">
        <h1>Continuous VLM-assisted Privacy Awareness</h1>
        <p>
          Please enter your <strong>Prolific ID</strong> to start the task.
          You will be assigned one egocentric video story and asked to review
          each clip with a simple annotation step (placeholder for now).
        </p>

        <form onSubmit={handleStart} style={{ marginTop: "1rem" }}>
          <label
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "0.5rem",
              alignItems: "center"
            }}
          >
            Prolific ID:
            <input
              type="text"
              value={participantId}
              onChange={(e) => setParticipantId(e.target.value)}
              style={{
                flex: "1 1 200px",
                width: "clamp(180px, 40vw, 360px)",
                minWidth: "160px",
                padding: "0.4rem 0.5rem"
              }}
            />
          </label>

          <div style={{ marginTop: "1rem" }}>
            <button type="submit" disabled={loading}>
              {loading ? "Assigning..." : "Start"}
            </button>
          </div>
        </form>

        {error && <p style={{ color: "red", marginTop: "1rem" }}>{error}</p>}
      </div>
    );
  }

  function renderTask() {
    if (!assignment || !storyConfig) return null;

    const clip = storyConfig.clips[currentClipIndex];
    const clipIndex = clip.clip_index ?? currentClipIndex + 1;
    const totalClips = storyConfig.clips.length;
    const hasWatchedCurrent = Boolean(clipCompletion[currentClipIndex]);
    const canGoBack = currentClipIndex > 0;
    const hasUnlockedForward = currentClipIndex < furthestClipUnlocked;
    const reachedLastClip = currentClipIndex >= totalClips - 1;
    const nextDisabled =
      reachedLastClip ||
      (!isTestMode && !hasUnlockedForward && !hasWatchedCurrent);
    const forwardButtonStyle =
      !isTestMode && !reachedLastClip && nextDisabled
        ? {
            opacity: 0.4,
            background: "transparent",
            border: "1px solid #ccc",
            color: "#555"
          }
        : {};
    const watchReminderNeeded =
      !isTestMode && !hasUnlockedForward && !hasWatchedCurrent && !reachedLastClip;

    return (
      <div className="card">
        <h2>Annotation Task</h2>
        <p>
          Clip {clipIndex} / {totalClips}
        </p>

        <div style={{ marginTop: "1rem" }}>
          {videoUrl ? (
            <VideoPlayerWithMarkers
              videoUrl={videoUrl}
              markers={[]}
              allowForwardSeek={isTestMode}
              pauseWhenInactive={!isTestMode}
              onEnded={() => handleClipFinished(currentClipIndex)}
            />
          ) : (
            <p>Loading video...</p>
          )}
        </div>

        <div
          style={{
            marginTop: "1rem",
            display: "flex",
            gap: "0.75rem",
            flexWrap: "wrap"
          }}
        >
          <button onClick={handlePreviousClip} disabled={!canGoBack}>
            Look Back
          </button>
          <button
            onClick={handleNextClipNavigate}
            disabled={nextDisabled}
            style={forwardButtonStyle}
          >
            Move Forward
          </button>
        </div>
        {(watchReminderNeeded || navNotice) && (
          <p style={{ color: "#a04500", marginTop: "0.5rem" }}>
            {navNotice || "Please finish this clip to move forward."}
          </p>
        )}

        <div style={{ marginTop: "1rem" }}>
          <h3>Placeholder annotation</h3>
          <p>
            For now, please just type anything here to simulate annotation.
            In the real study, this will be replaced with detailed privacy threat tagging.
          </p>
          <textarea
            value={annotationText}
            onChange={(e) => setAnnotationText(e.target.value)}
            rows={5}
            style={{ width: "100%", marginTop: "0.5rem" }}
            placeholder="Type your thoughts / perceived privacy risks here..."
          />
        </div>

        <div style={{ marginTop: "1rem" }}>
          <button onClick={handleSaveAndNext} disabled={loading || !annotationText}>
            {currentClipIndex + 1 < totalClips
              ? loading
                ? "Saving..."
                : "Save & Next Clip"
              : loading
              ? "Saving & Finishing..."
              : "Save & Finish Story"}
          </button>
        </div>

        {error && <p style={{ color: "red", marginTop: "1rem" }}>{error}</p>}
      </div>
    );
  }

  function renderFinished() {
    if (!assignment) return null;
    return (
      <div className="card">
        <h2>Task completed 🎉</h2>
        <p>
          Thank you, <strong>{participantId}</strong>.
        </p>
        <p>
          You have finished story <strong>{assignment.storyId}</strong> in mode{" "}
          <strong>{assignment.mode}</strong>.
        </p>
        <p>
          You can now return to Prolific and submit your completion code (if any).
        </p>
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
        background: "#f5f5f5",
        padding: "2rem"
      }}
    >
      <div
        style={{
          maxWidth: "800px",
          margin: "0 auto"
        }}
      >
        {!hasTask && !finished && renderIntro()}
        {hasTask && !finished && renderTask()}
        {finished && renderFinished()}
      </div>
    </div>
  );
}

export default App;
