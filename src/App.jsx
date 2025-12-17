// src/App.jsx
import { useEffect, useRef, useState } from "react";
import {
  assignParticipant,
  assignTestParticipant,
  presignGet,
  submitPreStudy,
  fetchStudyStatus,
  submitPostStudy,
  submitClipAnnotation,
  updateStage,
  markFinished,
  // markFinished,        // you can enable later when you wire it
} from "./api";
import InstructionsPage from "./components/InstructionsPage";
import PreStudyPage from "./components/PreStudyPage";
import PostStudyPage from "./components/PostStudyPage";
import TaskView from "./components/TaskView";

const PROLIFIC_COMPLETION_URL =
  import.meta.env.VITE_PROLIFIC_COMPLETION_URL ||
  "https://app.prolific.co/submissions/complete?cc=PLACEHOLDER_CODE";

// ---------- URL PARAMS (parsed once at module load) ----------
const params = new URLSearchParams(window.location.search);

const urlMode = (params.get("mode") || "").toLowerCase(); // "test" or ""
const IS_TEST_MODE = urlMode === "test";
const DEFAULT_FORMAL_STUDY = "formal_1";
const rawPilotFlag = (params.get("pilot") || "").toLowerCase();
const IS_PILOT_STUDY = rawPilotFlag === "true";
const ACTIVE_STUDY = IS_PILOT_STUDY ? "pilot" : DEFAULT_FORMAL_STUDY;

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

// Optional resume target clip (1-based), useful if a participant reports their last clip number.
const RESUME_CLIP_FROM_URL = (() => {
  const raw = params.get("clip") || params.get("resumeClip") || null;
  if (!raw) return null;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
})();

function App() {
  const [prolificId, setProlificId] = useState("");
  const [assignment, setAssignment] = useState(null);
  const [storyConfig, setStoryConfig] = useState(null);

  const [currentClipIndex, setCurrentClipIndex] = useState(0); // 0-based
  const [videoUrl, setVideoUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  const [clipCompletion, setClipCompletion] = useState({});
  const [clipSaving, setClipSaving] = useState(false);
  const [awaitingVlmInstruction, setAwaitingVlmInstruction] = useState(false);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [helpSlide, setHelpSlide] = useState(0);
  const [showVlmInfoModal, setShowVlmInfoModal] = useState(false);
  const [vlmAnalysis, setVlmAnalysis] = useState(null);
  const [participantStage, setParticipantStage] = useState(0); // 0=assigned,1=prestudy,2=annotation done,3=finished
  const [preStudyComplete, setPreStudyComplete] = useState(false);
  const [preStudySaving, setPreStudySaving] = useState(false);
  const [showPostStudyPage, setShowPostStudyPage] = useState(false);
  const [postStudyComplete, setPostStudyComplete] = useState(false);
  const [postStudySaving, setPostStudySaving] = useState(false);
  const [vlmCountdown, setVlmCountdown] = useState(15);
  const [showAnnotationHint, setShowAnnotationHint] = useState(false);
  const [annotationHintSeen, setAnnotationHintSeen] = useState(false);
  const hintDimOpacity = Number(import.meta.env.VITE_HINT_DIM_ALPHA ?? 0.4);

  const videoRef = useRef(null);
  const furthestTimeRef = useRef(0);
  const FORWARD_HEADROOM = 0.8; // seconds participants can scrub ahead of watched time

  const helpSlides = [
    "You will watch short, first-person video clips and imagine they reflect your own daily activities.",
    "Identify parts of each video you consider private, sensitive, or revealing and briefly explain why.",
    "There are no right or wrong answers—use your judgment about what feels privacy-related.",
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
    return cfg;
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
    setClipCompletion({});
    setClipSaving(false);
    setAwaitingVlmInstruction(false);
    setShowVlmInfoModal(false);
    setParticipantStage(0);
    setPreStudyComplete(false);
    setShowPostStudyPage(false);
    setPostStudyComplete(false);
    setShowAnnotationHint(false);
    setAnnotationHintSeen(false);

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
          study: ACTIVE_STUDY,
        });
      } else {
        // ---------- NORMAL STUDY MODE ----------
        assignRes = await assignParticipant(pid, ACTIVE_STUDY);
      }

      setAssignment(assignRes);
      setParticipantStage(assignRes.stage ?? 0);
      const cfg = await loadStoryConfig(assignRes.storyId, assignRes.mode);
      await maybeMarkPreStudyComplete(assignRes, pid, cfg);
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
    } catch (err) {
      console.error(err);
      setError(err.message || "Failed to load previous clip.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveClipResponses(payload) {
    const pid = resolvedParticipantId();
    if (!pid) {
      setError("Please enter your Prolific ID.");
      return false;
    }
    if (!assignment || !storyConfig) {
      setError("No assignment found. Please restart the study.");
      return false;
    }

    const clipCfg = storyConfig.clips?.[currentClipIndex];
    const clipIndexValue = Number(payload?.clipIndex) || currentClipIndex + 1;

    setClipSaving(true);
    setError("");
    setStatus("");
    try {
      await submitClipAnnotation({
        participantId: pid,
        studyId: assignment.studyId,
        storyId: assignment.storyId,
        mode: assignment.mode || assignment.assigned_mode,
        study: ACTIVE_STUDY,
        clipIndex: clipIndexValue,
         clipId: payload?.clipId || clipCfg?.clip_id || clipCfg?.clip_index || null,
         aiResponses: payload?.aiResponses || [],
         participantFindings: payload?.participantFindings || [],
         crossClipResponses: payload?.crossClipResponses || [],
         crossClipManualPrivacy: payload?.crossClipManualPrivacy ?? null,
         videoWatched: payload?.videoWatched ?? Boolean(clipCompletion[currentClipIndex]?.watched),
       });
      setStatus("Responses saved for this scenario.");
      setClipCompletion((prev) => {
        const prevEntry = prev[currentClipIndex] || {};
        return {
          ...prev,
          [currentClipIndex]: {
            watched: prevEntry.watched || payload?.videoWatched || false,
            saved: true,
          },
        };
      });
      return true;
    } catch (err) {
      console.error(err);
      setError(err.message || "Failed to save responses for this scenario.");
      return false;
    } finally {
      setClipSaving(false);
    }
  }

  async function handlePreStudySubmit(responses) {
    const pid = resolvedParticipantId();
    if (!pid) {
      setError("Please enter your Prolific ID.");
      return;
    }
    if (!assignment) {
      setError("No assignment found. Please restart the study.");
      return;
    }

    setPreStudySaving(true);
    setError("");
    setStatus("");
    try {
      const preStudyAnswers = Array.isArray(responses) ? responses : responses?.answers;
      const genAiUsage = Array.isArray(responses) ? null : responses?.genAiUsage;
      if (!Array.isArray(preStudyAnswers) || !preStudyAnswers.length) {
        setError("Please answer the pre-study questions before continuing.");
        return;
      }
      await submitPreStudy({
        participantId: pid,
        studyId: assignment.studyId,
        storyId: assignment.storyId,
        mode: assignment.mode || assignment.assigned_mode,
        study: ACTIVE_STUDY,
        answers: preStudyAnswers,
        ...(genAiUsage ? { genAiUsage } : {}),
      });
      setPreStudyComplete(true);
      setParticipantStage((prev) => Math.max(prev, 1));
      console.info("Stage advanced to 1 (pre-study complete).");
      setStatus("Pre-study responses saved. You can start annotating the clips.");
      if ((assignment.mode || assignment.assigned_mode) === "vlm") {
        setShowVlmInfoModal(true);
        setAwaitingVlmInstruction(true);
      }
    } catch (err) {
      console.error(err);
      setError(err.message || "Failed to save pre-study responses.");
    } finally {
      setPreStudySaving(false);
    }
  }

  async function handlePostStudySubmit(payload) {
    const pid = resolvedParticipantId();
    if (!pid) {
      setError("Please enter your Prolific ID.");
      return;
    }
    if (!assignment) {
      setError("No assignment found. Please restart the study.");
      return;
    }
    setPostStudySaving(true);
    setError("");
    setStatus("");
    try {
      await submitPostStudy({
        participantId: pid,
        studyId: assignment.studyId,
        storyId: assignment.storyId,
        mode: assignment.mode || assignment.assigned_mode,
        study: ACTIVE_STUDY,
        ...payload,
      });
      setPostStudyComplete(true);
      setParticipantStage(3);
      console.info("Stage advanced to 3 (post-study complete).");
      setStatus("Post-study responses saved. Thank you!");
      await markFinished(pid, ACTIVE_STUDY);
    } catch (err) {
      console.error(err);
      setError(err.message || "Failed to save post-study responses.");
    } finally {
      setPostStudySaving(false);
    }
  }

  async function maybeMarkPreStudyComplete(assignRes, pid, storyCfg) {
    try {
      const statusRes = await fetchStudyStatus(pid, ACTIVE_STUDY);
      if (statusRes?.stage != null) {
        setParticipantStage(statusRes.stage);
        console.info("Restored participant stage", statusRes.stage);
      }
      const stageVal = statusRes?.stage ?? 0;
      if (stageVal >= 1) {
        setPreStudyComplete(true);
      }
      if (statusRes?.prestudyExists || stageVal >= 1) {
        setPreStudyComplete(true);
        let didResume = false;

        // Restore saved/watched clip state so participants don't get stuck when navigating.
        const clipAnnotations = Array.isArray(statusRes?.clipAnnotations) ? statusRes.clipAnnotations : [];
        if (clipAnnotations.length > 0) {
          const restored = {};
          clipAnnotations.forEach((c) => {
            const clipIdx0 = Number(c?.clipIndex) - 1;
            if (!Number.isFinite(clipIdx0) || clipIdx0 < 0) return;
            // If a clip annotation exists in DynamoDB, treat the clip as watched so navigation works after refresh.
            restored[clipIdx0] = { watched: true, saved: true };
          });
          setClipCompletion((prev) => ({ ...prev, ...restored }));
        } else {
          // Fallback: if backend stores a current clip pointer, assume prior clips are saved.
          const curClip = Number(statusRes?.curClip);
          if (Number.isFinite(curClip) && curClip > 1 && storyCfg?.clips?.length) {
            const restored = {};
            const upto = Math.min(curClip - 1, storyCfg.clips.length);
            for (let idx = 0; idx < upto; idx += 1) {
              restored[idx] = { watched: true, saved: true };
            }
            setClipCompletion((prev) => ({ ...prev, ...restored }));
          }
        }

        // Resume to the next unsaved clip (or to an explicit URL override).
        if (stageVal < 2 && storyCfg?.clips?.length) {
          const total = storyCfg.clips.length;
          const statusResume = Number(statusRes?.resumeClipIndex);
          const curClip = Number(statusRes?.curClip);
          const fallbackResume =
            clipAnnotations.length > 0
              ? Math.max(...clipAnnotations.map((c) => Number(c?.clipIndex)).filter((n) => Number.isFinite(n))) + 1
              : null;
          const desired1Based =
            RESUME_CLIP_FROM_URL ||
            (Number.isFinite(statusResume) ? statusResume : null) ||
            (Number.isFinite(curClip) ? curClip : null) ||
            (Number.isFinite(fallbackResume) ? fallbackResume : null);

          if (desired1Based != null) {
            const target0 = Math.min(Math.max(desired1Based - 1, 0), total - 1);
            if (target0 !== currentClipIndex) {
              try {
                await loadClipByIndex(target0, storyCfg);
                setStatus(`Resumed at clip ${target0 + 1}.`);
                didResume = true;
              } catch (err) {
                console.warn("Failed to resume clip; falling back to clip 1:", err);
              }
            }
          }
        }

        if (stageVal >= 2) {
          setShowPostStudyPage(true);
          setStatus("Annotation already completed. Please finish the post-study questions.");
        } else if (!didResume) {
          setStatus("Pre-study already completed. You can start annotating the clips.");
        }
        if ((assignRes.mode || assignRes.assigned_mode) === "vlm" && stageVal < 2) {
          setShowVlmInfoModal(true);
          setAwaitingVlmInstruction(true);
        }
        return;
      }
    } catch (err) {
      console.warn("Pre-study status check failed:", err);
    }
    setPreStudyComplete(false);
    setStatus("Please complete the pre-study questions to begin the annotation task.");
  }

  async function handleProceedToPostStudy() {
    const pid = resolvedParticipantId();
    setShowPostStudyPage(true);
    setParticipantStage((prev) => Math.max(prev, 2));
    console.info("Stage advanced to 2 (annotation complete).");
    try {
      if (pid) {
        await updateStage(pid, 2, ACTIVE_STUDY);
        console.info("Stage update persisted (2) for participant", pid);
      }
    } catch (err) {
      console.warn("Stage update to 2 failed:", err);
    }
  }

  // ---------- UI ----------

  const hasAssignment = Boolean(assignment && storyConfig);
  const showPreStudy = hasAssignment && !preStudyComplete;
  const allClipsDone =
    Boolean(storyConfig?.clips?.length) &&
    storyConfig.clips.every((_, idx) => clipCompletion[idx]?.saved);
  const shouldShowPostStudy =
    hasAssignment && preStudyComplete && (showPostStudyPage || participantStage >= 2 || allClipsDone) && !postStudyComplete;
  const hasActiveTask = hasAssignment && preStudyComplete && !shouldShowPostStudy && participantStage < 2;

  const pageTitle = (() => {
    if (shouldShowPostStudy) {
      return "Post-study feedback";
    }
    if (hasActiveTask) {
      const mode = (assignment?.mode || "").toLowerCase();
      return mode === "vlm"
        ? "AI-assisted identification of privacy threats in egocentric videos"
        : "Identify privacy threats in egocentric videos";
    }
    if (showPreStudy) {
      return "Pre-study: your view on AI assistants";
    }
    return "Privacy Perception in Visual Content Understanding (30-45 minutes)";
  })();

  useEffect(() => {
    if (!hasActiveTask || annotationHintSeen) {
      setShowAnnotationHint(false);
      return;
    }
    const assignedMode = (assignment?.mode || assignment?.assigned_mode || "").toLowerCase();
    const isVlmAssigned = assignedMode === "vlm";
    if (isVlmAssigned && showVlmInfoModal) {
      // Delay hint + pre-hint prompt until participant closes the VLM info modal.
      setShowAnnotationHint(false);
      return;
    }
    setShowAnnotationHint(true);
  }, [hasActiveTask, annotationHintSeen, assignment, showVlmInfoModal]);

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

  useEffect(() => {
    if (allClipsDone && preStudyComplete && participantStage < 2) {
      handleProceedToPostStudy();
    }
  }, [allClipsDone, preStudyComplete, participantStage]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (participantStage >= 3) {
      setPostStudyComplete(true);
      setShowPostStudyPage(false);
      console.info("Participant at stage 3; post-study considered complete.");
    }
  }, [participantStage]);

  useEffect(() => {
    if (participantStage >= 2) {
      setShowPostStudyPage(true);
    }
  }, [participantStage]);

  useEffect(() => {
    // Ensure the viewport resets when moving between major stages/pages.
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [showPreStudy, shouldShowPostStudy, hasActiveTask, postStudyComplete]);

  useEffect(() => {
    if (postStudyComplete) {
      const timer = setTimeout(() => {
        console.info("Redirecting to Prolific completion link:", PROLIFIC_COMPLETION_URL);
        window.location.href = PROLIFIC_COMPLETION_URL;
      }, 1200);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [postStudyComplete]);

  useEffect(() => {
    if (!showVlmInfoModal) return undefined;

    // Only enforce the 15s countdown the first time participants enter VLM mode.
    // When they reopen the AI assistance info later, do not reset the timer.
    if (!awaitingVlmInstruction) {
      setVlmCountdown(0);
      return undefined;
    }

    setVlmCountdown(15);
    const interval = setInterval(() => {
      setVlmCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [showVlmInfoModal, awaitingVlmInstruction]);

  return (
    <div
      style={{
        maxWidth: "1440px",
        margin: "0 auto",
        padding: "24px 16px 40px",
        fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
      }}
    >
      {hasAssignment && (
        <h1 style={{ fontSize: "2rem", marginBottom: "8px" }}>{pageTitle}</h1>
      )}
      {testBanner}

      {!hasAssignment && (
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

      {showPreStudy && (
        <PreStudyPage
          onSubmit={handlePreStudySubmit}
          saving={preStudySaving}
          feedback={renderFeedback({ showStatus: true })}
        />
      )}

      {shouldShowPostStudy && (
        <PostStudyPage
          onSubmit={handlePostStudySubmit}
          saving={postStudySaving}
          feedback={renderFeedback({ showStatus: true })}
          mode={assignment?.mode || assignment?.assigned_mode}
        />
      )}

      {postStudyComplete && (
        <div className="container card" style={{ marginTop: "12px" }}>
          <h2>Thank you!</h2>
          <p>You have completed the study. A completion link will be provided via Prolific.</p>
          <a
            href={PROLIFIC_COMPLETION_URL}
            style={{
              display: "inline-block",
              padding: "10px 16px",
              borderRadius: "10px",
              border: "1px solid #1d4ed8",
              background: "#1d4ed8",
              color: "#fff",
              cursor: "pointer",
              fontWeight: 700,
              marginTop: "8px",
              textDecoration: "none",
            }}
          >
            Return to Prolific
          </a>
        </div>
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
          clipSaving={clipSaving}
          isTestMode={IS_TEST_MODE}
          handlePrevClip={handlePrevClip}
          handleNextClip={handleNextClip}
          handleFinishAnnotations={handleProceedToPostStudy}
          renderFeedback={renderFeedback}
          onSaveClipResponses={handleSaveClipResponses}
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
          hintMode={showAnnotationHint}
          onFinishHint={() => {
            setAnnotationHintSeen(true);
            setShowAnnotationHint(false);
          }}
          onCloseHint={() => {
            setAnnotationHintSeen(true);
            setShowAnnotationHint(false);
          }}
          onOpenHint={() => setShowAnnotationHint(true)}
          hintDimOpacity={hintDimOpacity}
          hintWasSeen={annotationHintSeen}
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
              <li>Judge if they are correct.</li>
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
                disabled={!IS_TEST_MODE && vlmCountdown > 0}
                aria-label="Close AI assistance info"
              >
                Got it{vlmCountdown > 0 ? ` (${vlmCountdown}s)` : ""}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
