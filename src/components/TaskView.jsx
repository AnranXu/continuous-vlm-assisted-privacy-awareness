// src/components/TaskView.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";

export default function TaskView({
  assignment,
  storyConfig,
  currentClipIndex,
  videoUrl,
  loading,
  clipCompletion,
  isTestMode,
  handlePrevClip,
  handleNextClip,
  renderFeedback,
  annotationText,
  setAnnotationText,
  handleSaveAnnotation,
  helpSlides,
  showHelpModal,
  setShowHelpModal,
  helpSlide,
  setHelpSlide,
  showVlmInfoModal,
  setShowVlmInfoModal,
  setAwaitingVlmInstruction,
  videoRef,
  clampToFurthest,
  furthestTimeRef,
  vlmAnalysis,
  setClipCompletion,
}) {
  const [currentTime, setCurrentTime] = useState(0);
  const [maxSeenTimeByClip, setMaxSeenTimeByClip] = useState({});
  const [videoHeight, setVideoHeight] = useState(null);
  const videoWrapRef = useRef(null);

  const currentClipMeta = useMemo(() => {
    if (!vlmAnalysis || !vlmAnalysis.clips || !storyConfig?.clips?.[currentClipIndex]) return null;
    const cfgClip = storyConfig.clips[currentClipIndex];
    const id = cfgClip.clip_id || cfgClip.clip_index;
    const found = vlmAnalysis.clips.find(
      (c) => c.clip_id === id || c.clip_index === cfgClip.clip_index || c.clip_index === currentClipIndex + 1
    );
    if (found) {
      console.info("VLM clip meta loaded", {
        clip: cfgClip.clip_id || cfgClip.clip_index,
        detections: found.detections?.length || 0,
      });
    } else {
      console.info("VLM clip meta not found", { clip: cfgClip.clip_id || cfgClip.clip_index });
    }
    return found;
  }, [vlmAnalysis, storyConfig, currentClipIndex]);

  const visibleDetections = useMemo(() => {
    if (!currentClipMeta || !currentClipMeta.detections) return [];
    const maxSeen =
      maxSeenTimeByClip[currentClipIndex] != null
        ? Math.max(currentTime, maxSeenTimeByClip[currentClipIndex])
        : currentTime;
    const vis = currentClipMeta.detections
      .filter((d) => d.time_sec == null || d.time_sec <= maxSeen + 0.01)
      .sort((a, b) => (a.time_sec || 0) - (b.time_sec || 0));
    console.info("Visible detections", {
      clip: currentClipMeta.clip_id || currentClipMeta.clip_index,
      visible: vis.length,
      total: currentClipMeta.detections.length,
      currentTime,
      maxSeen,
    });
    return vis;
  }, [currentClipMeta, currentTime, maxSeenTimeByClip, currentClipIndex]);

  function formatTime(sec) {
    if (sec == null || Number.isNaN(sec)) return "";
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60)
      .toString()
      .padStart(2, "0");
    return `${m}:${s}`;
  }

  useEffect(() => {
    if (!videoWrapRef.current) return undefined;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setVideoHeight(entry.contentRect.height || null);
      }
    });
    ro.observe(videoWrapRef.current);
    return () => ro.disconnect();
  }, []);

  return (
    <>
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
          {isTestMode ? (
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
              <span style={{ color: "#1d4ed8" }}>{currentClipIndex + 1}</span>{" "}
              of{" "}
              <span style={{ color: "#0ea5e9" }}>{storyConfig.clips.length}</span>
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
              color: currentClipIndex === 0 || loading ? "#475569" : "#fff",
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
            onClick={() => {
              const blocked =
                !storyConfig ||
                currentClipIndex >= storyConfig.clips.length - 1 ||
                loading ||
                (!isTestMode && !clipCompletion[currentClipIndex]);
              if (blocked) {
                alert("Finish watching this scenario to unlock Next.");
                return;
              }
              handleNextClip();
            }}
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
                  : (!isTestMode && !clipCompletion[currentClipIndex])
                  ? "#cbd5e1"
                  : "#1d4ed8",
              background:
                !storyConfig ||
                currentClipIndex >= storyConfig.clips.length - 1 ||
                loading
                  ? "#e2e8f0"
                  : (!isTestMode && !clipCompletion[currentClipIndex])
                  ? "#e2e8f0"
                  : "#1d4ed8",
              color:
                !storyConfig ||
                currentClipIndex >= storyConfig.clips.length - 1 ||
                loading
                  ? "#475569"
                  : (!isTestMode && !clipCompletion[currentClipIndex])
                  ? "#475569"
                  : "#fff",
              fontWeight: 700,
              boxShadow:
                !storyConfig ||
                currentClipIndex >= storyConfig.clips.length - 1 ||
                loading ||
                (!isTestMode && !clipCompletion[currentClipIndex])
                  ? "none"
                  : "0 8px 16px rgba(37, 99, 235, 0.25)",
              cursor:
                !storyConfig ||
                currentClipIndex >= storyConfig.clips.length - 1 ||
                loading ||
                (!isTestMode && !clipCompletion[currentClipIndex])
                  ? "default"
                  : "pointer",
              opacity:
                !isTestMode && !clipCompletion[currentClipIndex] ? 0.65 : 1,
              marginLeft: "12px",
            }}
          >
            Next clip
          </button>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: assignment?.mode === "vlm" ? "7fr 5fr" : "1fr",
          gap: "20px",
          alignItems: "start",
          marginBottom: "12px",
        }}
      >
        <div
          ref={videoWrapRef}
          style={{
            background: "#000",
            borderRadius: "8px",
            overflow: "hidden",
            maxHeight: "70vh",
            minHeight: "320px",
          }}
        >
          {videoUrl ? (
            <video
              key={videoUrl}
              ref={videoRef}
              src={videoUrl}
              controls
              onTimeUpdate={(e) => {
                const t = e.target.currentTime;
                setCurrentTime(t);
                setMaxSeenTimeByClip((prev) => {
                  const currentMax = prev[currentClipIndex] || 0;
                  return t > currentMax ? { ...prev, [currentClipIndex]: t } : prev;
                });
                if (isTestMode) return;
                const allowed = furthestTimeRef.current + 0.8;
                if (t > allowed) {
                  clampToFurthest(e.target);
                  return;
                }
                if (t > furthestTimeRef.current) {
                  furthestTimeRef.current = t;
                }
              }}
              onSeeking={(e) => {
                if (isTestMode) return;
                clampToFurthest(e.target);
              }}
              onPlay={(e) => clampToFurthest(e.target)}
              onEnded={() => {
                setClipCompletion((prev) => ({
                  ...prev,
                  [currentClipIndex]: true,
                }));
                if (!isTestMode) {
                  furthestTimeRef.current =
                    videoRef.current?.duration || furthestTimeRef.current;
                }
              }}
              onLoadedMetadata={() => {
                if (videoRef?.current) setVideoHeight(videoRef.current.clientHeight || null);
              }}
              onLoadedData={() => {
                if (videoRef?.current) setVideoHeight(videoRef.current.clientHeight || null);
              }}
              style={{ width: "100%", display: "block", height: "100%" }}
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

        {assignment?.mode === "vlm" && currentClipMeta && (
          <div
            style={{
              border: "1px solid #e2e8f0",
              borderRadius: "10px",
              padding: "12px",
              background: "#f8fafc",
              height: videoHeight ? `${videoHeight}px` : "auto",
              overflowY: videoHeight ? "auto" : "visible",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px" }}>
              <h3 style={{ margin: 0 }}>AI-suggested detections</h3>
            </div>
            {visibleDetections.length === 0 ? (
              <p style={{ marginTop: "8px", color: "#475569" }}>
                Keep watching to see AI detections appear.
              </p>
            ) : (
              <ul style={{ listStyle: "none", paddingLeft: 0, marginTop: "8px", marginBottom: 0 }}>
                {visibleDetections.map((d) => (
                  <li
                    key={d.det_id}
                    style={{
                      padding: "8px 10px",
                      border: "1px solid #e2e8f0",
                      borderRadius: "8px",
                      marginBottom: "8px",
                      background: "#fff",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <strong style={{ color: "#0f172a" }}>{d.detected_visual}</strong>
                      <span style={{ fontSize: "0.85rem", color: "#475569" }}>
                        {formatTime(d.time_sec || 0)}
                      </span>
                    </div>
                    <div style={{ fontSize: "0.95rem", color: "#334155", marginTop: "4px" }}>
                      {d.why_privacy_sensitive || "Potentially sensitive moment"}
                    </div>
                    <div style={{ fontSize: "0.85rem", color: "#475569", marginTop: "4px" }}>
                      Severity: {d.severity ?? "n/a"} | Confidence: {d.confidence ?? "n/a"}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* Annotation placeholder */}
      {renderFeedback({ showStatus: !isTestMode })}
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
    </>
  );
}
