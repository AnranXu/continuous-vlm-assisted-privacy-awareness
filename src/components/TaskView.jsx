// src/components/TaskView.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";

const LIKERT_OPTIONS = [-3, -2, -1, 0, 1, 2, 3];

const CATEGORY_OPTIONS = [
  {
    value: "personal information",
    label: "Personal information (e.g., identity, health, finances, personal documents)",
  },
  {
    value: "location of shooting",
    label: "Location of shooting (where the scene takes place)",
  },
  {
    value: "individual preferences/pastimes",
    label: "Individual preferences or pastimes (e.g., hobbies, interests, tastes)",
  },
  {
    value: "social circle or relationships",
    label: "Social circle or relationships (e.g., who your friends, family, or colleagues are)",
  },
  {
    value: "others_private_or_confidential_information",
    label: "Others' private or confidential information (e.g., another person's ID, screen, or documents)",
  },
  {
    value: "other type of sensitive content",
    label: "Other type of sensitive content not listed above",
  },
  {
    value: "none",
    label: "I do not see any privacy-related content in this video clip",
  },
];

function createEmptyFinding() {
  return {
    finding_id: `manual_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
    categories: [],
    other_text: "",
    description: "",
    privacy_threat_score: null,
    share_willingness_score: null,
    ai_memory_comfort_score: null,
  };
}

export default function TaskView({
  assignment,
  storyConfig,
  currentClipIndex,
  videoUrl,
  loading,
  clipCompletion,
  setClipCompletion,
  clipSaving,
  isTestMode,
  handlePrevClip,
  handleNextClip,
  handleFinishAnnotations,
  renderFeedback,
  onSaveClipResponses,
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
  hintMode = false,
  onFinishHint = () => {},
  onCloseHint = () => {},
  onOpenHint,
  hintDimOpacity = 0.45,
  hintWasSeen = false,
}) {
  const [currentTime, setCurrentTime] = useState(0);
  const [maxSeenTimeByClip, setMaxSeenTimeByClip] = useState({});
  const [videoHeight, setVideoHeight] = useState(null);
  const [aiAnswersByClip, setAiAnswersByClip] = useState({});
  const [openDetectionByClip, setOpenDetectionByClip] = useState({});
  const [manualFindingsByClip, setManualFindingsByClip] = useState({});
  const [expandedManualId, setExpandedManualId] = useState(null);
  const [seenDetectionsByClip, setSeenDetectionsByClip] = useState({});
  const [newDetectionPrompt, setNewDetectionPrompt] = useState(null);
  const [crossThreatAnswers, setCrossThreatAnswers] = useState({});
  const [hintAiAnswersByClip, setHintAiAnswersByClip] = useState({});
  const [hintOpenDetectionByClip, setHintOpenDetectionByClip] = useState({});
  const [hintManualFindingsByClip, setHintManualFindingsByClip] = useState({});
  const [hintExpandedManualId, setHintExpandedManualId] = useState(null);
  const [hintCrossThreatAnswers, setHintCrossThreatAnswers] = useState({});
  const [hintSeenDetectionsByClip, setHintSeenDetectionsByClip] = useState({});
  const [hintClipCount, setHintClipCount] = useState(1);
  const [hintStepIndex, setHintStepIndex] = useState(0);
  const videoWrapRef = useRef(null);
  const totalClips = storyConfig?.clips?.length || 1;
  const isLastClip = Boolean(storyConfig?.clips?.length) && currentClipIndex === storyConfig.clips.length - 1;
  const dimLevel = Number.isFinite(Number(hintDimOpacity)) ? Number(hintDimOpacity) : 0.5;
  const resolvedMode = (assignment?.mode || assignment?.assigned_mode || "human").toLowerCase();
  const isVlmMode = resolvedMode === "vlm";
  const hintSteps = isVlmMode
    ? ["ai-intro", "ai-expand", "next-clip", "cross", "manual", "finish"]
    : ["next-clip", "manual", "finish"];
  const hintStepKey = hintSteps[Math.min(hintStepIndex, hintSteps.length - 1)];
  const focusMap = {
    "ai-intro": "ai",
    "ai-expand": "ai",
    "next-clip": "nav",
    cross: "ai",
    manual: "manual",
    finish: "manual",
  };
  const focusedSection = hintMode ? focusMap[hintStepKey] || "ai" : null;
  const sectionHintStyle = (key) =>
    !hintMode
      ? {}
      : {
          opacity: focusedSection === key ? 1 : dimLevel,
          pointerEvents: focusedSection === key ? "auto" : "none",
          transition: "opacity 0.25s ease",
        };
  const hintBoxStyle = {
    marginTop: "10px",
    padding: "10px 12px",
    borderRadius: "10px",
    border: "1px solid #1d4ed8",
    background: "#eef2ff",
    color: "#0f172a",
    boxShadow: "0 12px 24px rgba(0,0,0,0.12)",
  };
  const hintActionStyle = {
    padding: "8px 12px",
    borderRadius: "8px",
    border: "1px solid #1d4ed8",
    background: "#1d4ed8",
    color: "#fff",
    cursor: "pointer",
    fontWeight: 700,
  };
  useEffect(() => {
    if (!hintMode) return;
    const safeCount = Math.min(totalClips, Math.max(currentClipIndex + 1, 1));
    setHintStepIndex(0);
    setHintClipCount(safeCount);
    setHintAiAnswersByClip({});
    setHintOpenDetectionByClip({});
    setHintManualFindingsByClip({});
    setHintExpandedManualId(null);
    setHintCrossThreatAnswers({});
    setHintSeenDetectionsByClip({});
  }, [hintMode, currentClipIndex, resolvedMode, totalClips]);

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

  const activeAiAnswersByClip = hintMode ? hintAiAnswersByClip : aiAnswersByClip;
  const activeOpenDetectionByClip = hintMode ? hintOpenDetectionByClip : openDetectionByClip;
  const activeManualFindingsByClip = hintMode ? hintManualFindingsByClip : manualFindingsByClip;
  const activeCrossThreatAnswers = hintMode ? hintCrossThreatAnswers : crossThreatAnswers;
  const activeSeenDetectionsByClip = hintMode ? hintSeenDetectionsByClip : seenDetectionsByClip;
  const activeExpandedManualId = hintMode ? hintExpandedManualId : expandedManualId;
  const setActiveExpandedManualId = hintMode ? setHintExpandedManualId : setExpandedManualId;
  const setActiveAiAnswersByClip = hintMode ? setHintAiAnswersByClip : setAiAnswersByClip;
  const setActiveOpenDetectionByClip = hintMode ? setHintOpenDetectionByClip : setOpenDetectionByClip;
  const setActiveManualFindingsByClip = hintMode ? setHintManualFindingsByClip : setManualFindingsByClip;
  const setActiveCrossThreatAnswers = hintMode ? setHintCrossThreatAnswers : setCrossThreatAnswers;
  const setActiveSeenDetectionsByClip = hintMode ? setHintSeenDetectionsByClip : setSeenDetectionsByClip;
  const displayNewDetectionPrompt = hintMode ? null : newDetectionPrompt;
  const setDisplayNewDetectionPrompt = hintMode ? () => {} : setNewDetectionPrompt;

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

  const hintSingleDetections = useMemo(
    () => [
      {
        det_id: "hint_det_1",
        detected_visual: "Laptop screen showing private messages",
        time_sec: 12,
        information_types: ["Other type of sensitive content"],
        why_privacy_sensitive: "Screens can expose personal conversations.",
        severity: "medium",
        confidence: "medium",
      },
      {
        det_id: "hint_det_2",
        detected_visual: "House number visible at doorway",
        time_sec: 28,
        information_types: ["Location of shooting"],
        why_privacy_sensitive: "Addresses can reveal where you live.",
        severity: "medium",
        confidence: "medium",
      },
    ],
    []
  );

  const hintCrossThreats = useMemo(
    () => [
      {
        threat_id: "hint_cross_1",
        title: "Same workplace badge appears in two clips",
        clips_involved: [1, 2],
        information_types: ["personal information"],
        severity_overall: "medium",
        confidence: "medium",
        why_amplified_across_clips: "Seeing the badge in multiple clips makes it easier to identify you.",
        evidence_summary: "Badge is visible when entering the building and again while sitting at a desk.",
      },
    ],
    []
  );

  const displayDetections = hintMode && isVlmMode ? hintSingleDetections : visibleDetections;

  const groupedDetections = useMemo(() => {
    const groups = {};
    displayDetections.forEach((d) => {
      const types = Array.isArray(d.information_types) && d.information_types.length
        ? d.information_types
        : ["Other"];
      types.forEach((t) => {
        if (!groups[t]) groups[t] = [];
        groups[t].push(d);
      });
    });
    return Object.entries(groups).map(([infoType, list]) => ({ infoType, list }));
  }, [displayDetections]);

  const seenClipIndices = useMemo(() => {
    if (hintMode) {
      const seen = new Set();
      const viewed = Math.max(1, hintClipCount);
      for (let i = 0; i < viewed; i += 1) {
        seen.add(i);
      }
      return seen;
    }
    const seen = new Set();
    Object.entries(maxSeenTimeByClip || {}).forEach(([idx, t]) => {
      if (t != null) seen.add(Number(idx));
    });
    Object.entries(clipCompletion || {}).forEach(([idx, status]) => {
      const entry = status || {};
      if (entry.watched || entry.saved) seen.add(Number(idx));
    });
    return seen;
  }, [hintMode, hintClipCount, maxSeenTimeByClip, clipCompletion]);

  const unlockedCrossClipThreats = useMemo(() => {
    if (!vlmAnalysis?.story?.cross_clip_threats) return [];
    return vlmAnalysis.story.cross_clip_threats.filter((threat) => {
      if (!Array.isArray(threat.clips_involved) || threat.clips_involved.length === 0) return false;
      return threat.clips_involved.every((clipNum) => {
        const n = Number(clipNum);
        if (!Number.isFinite(n)) return false;
        return seenClipIndices.has(n - 1);
      });
    });
  }, [vlmAnalysis, seenClipIndices]);

  const crossThreatsForUi =
    hintMode && isVlmMode
      ? hintClipCount > 1 || hintStepIndex >= hintSteps.indexOf("cross")
        ? hintCrossThreats
        : []
      : unlockedCrossClipThreats;

  const crossClipThreatCount = hintMode && isVlmMode
    ? crossThreatsForUi.length
    : vlmAnalysis?.story?.cross_clip_threats?.length || 0;

  const clipsViewedCount = hintMode
    ? hintClipCount
    : Math.max(seenClipIndices.size, currentClipIndex + 1);
  const clipProgressLabel = `${Math.min(clipsViewedCount, totalClips)}/${totalClips} clips have been viewed`;
  const nextButtonDisabled =
    hintMode
      ? false
      : !storyConfig ||
        currentClipIndex >= totalClips - 1 ||
        loading ||
        (!isTestMode && !clipIsSaved);

  const currentClipStatus = clipCompletion?.[currentClipIndex] || { watched: false, saved: false };
  const clipIsSaved = hintMode ? true : Boolean(currentClipStatus.saved);
  const clipWatched = hintMode ? true : Boolean(currentClipStatus.watched);
  const currentAiAnswers = activeAiAnswersByClip[currentClipIndex] || {};
  const currentManualFindings = activeManualFindingsByClip[currentClipIndex] || [];
  const openDetectionId = activeOpenDetectionByClip[currentClipIndex] || null;
  const seenDetections = new Set(activeSeenDetectionsByClip[currentClipIndex] || []);
  const currentCrossAnswers = activeCrossThreatAnswers[currentClipIndex] || {};
  const manualCategoryCounts = useMemo(() => {
    const counts = {};
    currentManualFindings.forEach((f) => {
      (f.categories || []).forEach((c) => {
        counts[c] = (counts[c] || 0) + 1;
      });
    });
    return counts;
  }, [currentManualFindings]);
  const categoryLabelMap = useMemo(() => {
    const map = {};
    CATEGORY_OPTIONS.forEach((opt) => {
      map[opt.value] = opt.label;
    });
    return map;
  }, []);

  function isLikertScore(val) {
    const n = Number(val);
    return Number.isFinite(n) && n >= -3 && n <= 3;
  }

  function isAiResponseComplete(ans) {
    if (!ans) return false;
    return (
      isLikertScore(ans.privacy_threat_score) &&
      isLikertScore(ans.share_willingness_score) &&
      isLikertScore(ans.ai_memory_comfort_score) &&
      isLikertScore(ans.trust_ai_score)
    );
  }

  function isFindingComplete(f) {
    if (!f) return false;
    const hasCategories = Array.isArray(f.categories) && f.categories.length > 0;
    const desc = (f.description || "").trim();
    const needsOther = f.categories?.includes("other");
    const otherTextOk = !needsOther || (f.other_text || "").trim().length > 0;
    const isNone = f.categories?.includes("none");
    if (isNone) {
      return hasCategories && desc.length > 0;
    }
    return (
      hasCategories &&
      isLikertScore(f.privacy_threat_score) &&
      isLikertScore(f.share_willingness_score) &&
      isLikertScore(f.ai_memory_comfort_score) &&
      desc.length > 0 &&
      otherTextOk
    );
  }

  function isCrossResponseComplete(ans) {
    if (!ans) return false;
    return (
      isLikertScore(ans.cross_privacy_threat_score) &&
      isLikertScore(ans.cross_more_severe_score) &&
      isLikertScore(ans.cross_ai_memory_comfort_score)
    );
  }

  const aiRequiredCount = isVlmMode ? displayDetections.length : 0;
  const aiCompletedCount =
    isVlmMode
      ? displayDetections.filter((d) => isAiResponseComplete(currentAiAnswers[d.det_id])).length
      : 0;

  const completedManualFindings = currentManualFindings.filter((f) => isFindingComplete(f));
  const allManualComplete =
    currentManualFindings.length > 0 && completedManualFindings.length === currentManualFindings.length;

  const crossRequiredCount = crossThreatsForUi.length;
  const crossCompletedCount = crossThreatsForUi.filter((t) =>
    isCrossResponseComplete(currentCrossAnswers[t.threat_id || t.title])
  ).length;
  const allCrossComplete = crossRequiredCount === 0 || crossCompletedCount === crossRequiredCount;

  const canSaveClip =
    hintMode ||
    (allManualComplete &&
      (!isVlmMode || aiCompletedCount === aiRequiredCount) &&
      allCrossComplete &&
      (isTestMode || clipWatched));

  function formatTime(sec) {
    if (sec == null || Number.isNaN(sec)) return "";
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60)
      .toString()
      .padStart(2, "0");
    return `${m}:${s}`;
  }

  function formatList(list) {
    if (!Array.isArray(list) || list.length === 0) return "";
    return list.join(", ");
  }

  function markClipDirty(idx = currentClipIndex) {
    if (hintMode) return;
    setClipCompletion((prev) => {
      const entry = prev[idx] || {};
      return { ...prev, [idx]: { watched: entry.watched || false, saved: false } };
    });
  }

  function updateAiAnswer(detId, key, value) {
    setActiveAiAnswersByClip((prev) => {
      const clipMap = { ...(prev[currentClipIndex] || {}) };
      clipMap[detId] = { ...(clipMap[detId] || {}), [key]: value };
      return { ...prev, [currentClipIndex]: clipMap };
    });
    markClipDirty(currentClipIndex);
  }

  function toggleDetection(detId) {
    setActiveOpenDetectionByClip((prev) => ({
      ...prev,
      [currentClipIndex]: prev[currentClipIndex] === detId ? null : detId,
    }));
    setDisplayNewDetectionPrompt((prev) => (prev?.detId === detId ? null : prev));
  }

  function resetManualDraft() {
    setManualDraft(createEmptyFinding());
    setEditingFindingId(null);
  }

  function addManualFinding(category) {
    if (category === "none") {
      const already = (currentManualFindings || []).some((f) => f.categories?.includes("none"));
      if (already) return;
    }
    const newEntry = {
      finding_id: `manual_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
      categories: [category],
      other_text: "",
      description: "",
      privacy_threat_score: null,
      share_willingness_score: null,
      ai_memory_comfort_score: null,
    };
    setActiveManualFindingsByClip((prev) => {
      const list = [...(prev[currentClipIndex] || [])];
      list.push(newEntry);
      return { ...prev, [currentClipIndex]: list };
    });
    setActiveExpandedManualId(newEntry.finding_id);
    markClipDirty(currentClipIndex);
  }

  function updateManualField(findingId, key, value) {
    setActiveManualFindingsByClip((prev) => {
      const list = (prev[currentClipIndex] || []).map((f) =>
        f.finding_id === findingId ? { ...f, [key]: value } : f
      );
      return { ...prev, [currentClipIndex]: list };
    });
    markClipDirty(currentClipIndex);
  }

  function toggleManualExpand(findingId) {
    setActiveExpandedManualId((prev) => (prev === findingId ? null : findingId));
  }

  function deleteManualFinding(findingId) {
    setActiveManualFindingsByClip((prev) => {
      const list = (prev[currentClipIndex] || []).filter((f) => f.finding_id !== findingId);
      return { ...prev, [currentClipIndex]: list };
    });
    if (activeExpandedManualId === findingId) {
      setActiveExpandedManualId(null);
    }
    markClipDirty(currentClipIndex);
  }

  function updateCrossAnswer(threatId, key, value) {
    setActiveCrossThreatAnswers((prev) => {
      const forClip = { ...(prev[currentClipIndex] || {}) };
      const entry = { ...(forClip[threatId] || {}) };
      entry[key] = value;
      forClip[threatId] = entry;
      return { ...prev, [currentClipIndex]: forClip };
    });
    markClipDirty(currentClipIndex);
  }

  const LikertScale = ({ label, helper, name, value, onChange }) => (
    <div style={{ marginTop: "8px" }}>
      <div style={{ fontWeight: 700, color: "#0f172a" }}>{label}</div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "10px",
          marginTop: "8px",
        }}
        >
          {LIKERT_OPTIONS.map((n) => (
            <label
              key={`${name}-${n}`}
              style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "6px 8px",
              borderRadius: "8px",
              border: value === n ? "2px solid #1d4ed8" : "1px solid #cbd5e1",
              background: value === n ? "#e0e7ff" : "#fff",
              cursor: "pointer",
            }}
          >
            <input
              type="radio"
              name={name}
              value={n}
              checked={value === n}
              onChange={() => onChange(n)}
            />
            <span style={{ fontWeight: 700 }}>{n}</span>
          </label>
        ))}
        <span style={{ color: "#475569", fontSize: "0.85rem" }}>
          -3 = Strongly disagree / 3 = Strongly agree
        </span>
      </div>
      {helper && (
        <div style={{ color: "#475569", fontSize: "0.9rem", marginTop: "4px" }}>
          {helper}
        </div>
      )}
    </div>
  );

  function buildAiPayload() {
    if (hintMode || assignment?.mode !== "vlm") return [];
    const detections = currentClipMeta?.detections || [];
    return detections
      .map((d) => {
        const ans = currentAiAnswers[d.det_id] || {};
        return {
          det_id: d.det_id,
          detected_visual: d.detected_visual,
          time_sec: d.time_sec,
          information_types: d.information_types,
          severity: d.severity,
          confidence: d.confidence,
          privacy_threat_score: ans.privacy_threat_score,
          share_willingness_score: ans.share_willingness_score,
          ai_memory_comfort_score: ans.ai_memory_comfort_score,
          trust_ai_score: ans.trust_ai_score,
        };
      })
      .filter((entry) => isAiResponseComplete(entry));
  }

  function buildManualPayload() {
    return currentManualFindings.map((f) => ({
      finding_id: f.finding_id,
      categories: f.categories,
      other_text: f.other_text,
      description: f.description,
      privacy_threat_score: f.privacy_threat_score,
      share_willingness_score: f.share_willingness_score,
      ai_memory_comfort_score: f.ai_memory_comfort_score,
    }));
  }

  function buildCrossPayload() {
    if (hintMode) return [];
    return crossThreatsForUi
      .map((t) => {
        const ans = currentCrossAnswers[t.threat_id || t.title] || {};
        return {
          threat_id: t.threat_id || t.title,
          title: t.title,
          clips_involved: t.clips_involved,
          information_types: t.information_types,
          severity_overall: t.severity_overall,
          confidence: t.confidence,
          cross_privacy_threat_score: ans.cross_privacy_threat_score,
          cross_more_severe_score: ans.cross_more_severe_score,
          cross_ai_memory_comfort_score: ans.cross_ai_memory_comfort_score,
        };
      })
      .filter((entry) => isCrossResponseComplete(entry));
  }

  useEffect(() => {
    if (hintMode || !visibleDetections.length) return;
    const seenSet = new Set(activeSeenDetectionsByClip[currentClipIndex] || []);
    const firstNew = visibleDetections.find((d) => !seenSet.has(d.det_id));
    if (!firstNew) return;

    const triggerTime = firstNew.time_sec != null ? firstNew.time_sec : currentTime;
    if (triggerTime < 10 && currentTime < 10) return;

    seenSet.add(firstNew.det_id);
    setActiveSeenDetectionsByClip((prev) => ({
      ...prev,
      [currentClipIndex]: Array.from(seenSet),
    }));
    setDisplayNewDetectionPrompt({
      detId: firstNew.det_id,
      text: firstNew.detected_visual || "New AI-suggested privacy threat",
    });
    if (videoRef?.current) {
      try {
        videoRef.current.pause();
      } catch (err) {
        console.warn("Failed to pause video on new detection:", err);
      }
    }
  }, [visibleDetections, currentClipIndex, currentTime, activeSeenDetectionsByClip, videoRef, hintMode]);

  async function handleSaveClip() {
    if (hintMode) {
      setHintStepIndex((prev) => Math.min(prev + 1, hintSteps.length - 1));
      return;
    }
    if (!canSaveClip) {
      alert("Please answer all required questions for this scenario before saving.");
      return;
    }
    const clipMeta = storyConfig?.clips?.[currentClipIndex];
    await onSaveClipResponses({
      clipIndex: currentClipIndex + 1,
      clipId: clipMeta?.clip_id || clipMeta?.clip_index || null,
      aiResponses: buildAiPayload(),
      participantFindings: buildManualPayload(),
      crossClipResponses: buildCrossPayload(),
      videoWatched: clipWatched,
    });
  }

  function handleNextButton() {
    if (hintMode) {
      setHintClipCount((prev) => Math.min(prev + 1, totalClips));
      setHintStepIndex((prev) => Math.min(prev + 1, hintSteps.length - 1));
      return;
    }
    const blocked =
      !storyConfig ||
      currentClipIndex >= totalClips - 1 ||
      loading ||
      (!isTestMode && !clipIsSaved);
    if (blocked) {
      alert("Finish and save this scenario to unlock Next.");
      return;
    }
    handleNextClip();
  }

  function handlePrevButton() {
    if (hintMode) return;
    handlePrevClip();
  }

  const advanceHint = () => setHintStepIndex((prev) => Math.min(prev + 1, hintSteps.length - 1));

  const finishHintFlow = () => {
    setHintStepIndex(0);
    if (onFinishHint) onFinishHint();
  };

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

  useEffect(() => {
    setAiAnswersByClip({});
    setOpenDetectionByClip({});
    setManualFindingsByClip({});
    setSeenDetectionsByClip({});
    setNewDetectionPrompt(null);
    setCrossThreatAnswers({});
    setHintAiAnswersByClip({});
    setHintOpenDetectionByClip({});
    setHintManualFindingsByClip({});
    setHintExpandedManualId(null);
    setHintCrossThreatAnswers({});
    setHintSeenDetectionsByClip({});
    setHintClipCount(1);
    setHintStepIndex(0);
  }, [assignment?.storyId, storyConfig?.story_id]);

  return (
    <>
      <div style={{ marginBottom: "10px", ...sectionHintStyle("header") }}>
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
              <span style={{ color: "#0ea5e9" }}>{totalClips}</span>
            </>
          )}
        </h2>
      </div>

      <div
        style={{
          ...sectionHintStyle("nav"),
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
            View task requirements
          </button>
          {typeof onOpenHint === "function" && !hintMode && (
            <button
              type="button"
              onClick={() => onOpenHint()}
              style={{
                padding: "8px 12px",
                borderRadius: "10px",
                border: "1px solid #1d4ed8",
                background: "#e0f2fe",
                cursor: "pointer",
                color: "#0f172a",
              }}
            >
              {hintWasSeen ? "View annotation hint again" : "View annotation hint"}
            </button>
          )}
          {hintMode && (
            <button
              type="button"
              onClick={() => (onCloseHint ? onCloseHint() : null)}
              style={{
                padding: "8px 12px",
                borderRadius: "10px",
                border: "1px solid #cbd5e1",
                background: "#fff",
                cursor: "pointer",
                color: "#0f172a",
              }}
            >
              Exit hint
            </button>
          )}
          {isVlmMode && (
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
            onClick={handlePrevButton}
            disabled={hintMode || currentClipIndex === 0 || loading}
            style={{
              padding: "10px 14px",
              borderRadius: "10px",
              border: "1px solid",
              borderColor:
                hintMode || currentClipIndex === 0 || loading ? "#cbd5e1" : "#1d4ed8",
              background:
                hintMode || currentClipIndex === 0 || loading ? "#e2e8f0" : "#1d4ed8",
              color: hintMode || currentClipIndex === 0 || loading ? "#475569" : "#fff",
              fontWeight: 700,
              boxShadow:
                hintMode || currentClipIndex === 0 || loading
                  ? "none"
                  : "0 8px 16px rgba(37, 99, 235, 0.25)",
              cursor:
                hintMode || currentClipIndex === 0 || loading ? "default" : "pointer",
            }}
          >
            Previous clip
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <button
              type="button"
              onClick={handleNextButton}
              disabled={nextButtonDisabled}
              style={{
                padding: "10px 14px",
                borderRadius: "10px",
                border: "1px solid",
                borderColor: nextButtonDisabled ? "#cbd5e1" : "#1d4ed8",
                background: nextButtonDisabled ? "#e2e8f0" : "#1d4ed8",
                color: nextButtonDisabled ? "#475569" : "#fff",
                fontWeight: 700,
                boxShadow: nextButtonDisabled ? "none" : "0 8px 16px rgba(37, 99, 235, 0.25)",
                cursor: nextButtonDisabled ? "default" : "pointer",
                opacity: nextButtonDisabled && !hintMode ? 0.65 : 1,
                marginLeft: "12px",
              }}
            >
              Next clip
            </button>
            <span style={{ fontSize: "0.9rem", color: "#475569", fontWeight: 600 }}>
              {clipProgressLabel}
            </span>
          </div>
          {isLastClip && (
            <button
              type="button"
              disabled={
                hintMode ||
                !storyConfig ||
                loading ||
                (!isTestMode && !clipIsSaved)
              }
              onClick={() => {
                const blocked =
                  hintMode ||
                  !storyConfig ||
                  loading ||
                  (!isTestMode && !clipIsSaved);
                if (blocked) {
                  alert("Finish and save this scenario to continue.");
                  return;
                }
                handleFinishAnnotations();
              }}
              style={{
                padding: "10px 14px",
                borderRadius: "10px",
                border: "1px solid #16a34a",
                background:
                  !storyConfig ||
                  loading ||
                  (!isTestMode && !clipIsSaved)
                    ? "#a7f3d0"
                    : "#16a34a",
                color:
                  !storyConfig ||
                  loading ||
                  (!isTestMode && !clipIsSaved)
                    ? "#065f46"
                    : "#fff",
                fontWeight: 800,
                boxShadow:
                  !storyConfig ||
                  loading ||
                  (!isTestMode && !clipIsSaved)
                    ? "none"
                    : "0 10px 18px rgba(22, 163, 74, 0.35)",
                cursor:
                  !storyConfig ||
                  loading ||
                  (!isTestMode && !clipIsSaved)
                    ? "not-allowed"
                    : "pointer",
                marginLeft: "12px",
              }}
            >
              Finish annotation
            </button>
          )}
        </div>
        {hintMode && hintStepKey === "next-clip" && (
          <div style={{ ...hintBoxStyle, width: "100%" }}>
            <strong>Advance when you are ready</strong>
            <p style={{ margin: "6px 0" }}>
              Click “Next clip” to move on. The counter shows your progress ({clipProgressLabel}).
            </p>
          </div>
        )}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: isVlmMode ? "7fr 5fr" : "1fr",
          gap: "20px",
          alignItems: "start",
          marginBottom: "12px",
        }}
      >
        <div
          ref={videoWrapRef}
          style={{
            ...sectionHintStyle("video"),
            background: "#000",
            borderRadius: "8px",
            overflow: "visible",
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
                if (hintMode) return;
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
                if (hintMode) return;
                if (isTestMode) return;
                clampToFurthest(e.target);
              }}
              onPlay={(e) => {
                if (hintMode) return;
                clampToFurthest(e.target);
              }}
              onEnded={() => {
                if (hintMode) return;
                setClipCompletion((prev) => ({
                  ...prev,
                  [currentClipIndex]: { ...(prev[currentClipIndex] || {}), watched: true },
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
              style={{ width: "100%", display: "block", height: "auto", maxHeight: "70vh" }}
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

        {isVlmMode && (currentClipMeta || hintMode) && (
          <div
            style={{
              ...sectionHintStyle("ai"),
              border: "1px solid #e2e8f0",
              borderRadius: "10px",
              padding: "12px",
              background: "#f8fafc",
              height: videoHeight ? `${videoHeight}px` : "auto",
              overflowY: videoHeight ? "auto" : "visible",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px" }}>
              <h3 style={{ margin: 0 }}>AI-suggested detections on single scenario</h3>
              <span
                style={{
                  fontSize: "0.9rem",
                  color: aiCompletedCount === aiRequiredCount ? "#065f46" : "#b45309",
                  fontWeight: 700,
                }}
              >
                {aiRequiredCount > 0
                  ? `Answered ${aiCompletedCount} / ${aiRequiredCount}`
                  : "No AI detections visible yet"}
              </span>
            </div>
            {hintMode && hintStepKey === "ai-intro" && (
              <div style={hintBoxStyle}>
                <strong>AI assistant is watching with you</strong>
                <p style={{ margin: "6px 0" }}>
                  As you watch videos, an AI assistant will also detect privacy risks for you. Once the AI assistant
                  detects privacy risks, you will be asked related questions.
                </p>
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                  <button type="button" style={hintActionStyle} onClick={advanceHint}>
                    Next hint
                  </button>
                </div>
              </div>
            )}
            {hintMode && hintStepKey === "ai-expand" && (
              <div style={hintBoxStyle}>
                <strong>Review each AI detection</strong>
                <p style={{ margin: "6px 0" }}>
                  This is a sample AI-suggested detection for one scenario. Click “Expand” to see the detailed questions
                  for you to answer, and “Collapse” to fold the questions. <strong>You need to answer every question for each
                  detected result.</strong>
                </p>
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                  <button type="button" style={hintActionStyle} onClick={advanceHint}>
                    Next hint
                  </button>
                </div>
              </div>
            )}
            {displayNewDetectionPrompt && (
              <div
                style={{
                  marginTop: "8px",
                  padding: "10px 12px",
                  borderRadius: "10px",
                  border: "1px solid #fbbf24",
                  background: "#fffbeb",
                  color: "#92400e",
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  flexWrap: "wrap",
                }}
              >
                <span
                  style={{
                    padding: "4px 8px",
                    borderRadius: "999px",
                    background: "#f87171",
                    color: "#fff",
                    fontWeight: 800,
                    fontSize: "0.85rem",
                  }}
                >
                  New privacy threat
                </span>
                <span style={{ fontWeight: 700 }}>{displayNewDetectionPrompt.text}</span>
                <div style={{ marginLeft: "auto", display: "flex", gap: "8px" }}>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveOpenDetectionByClip((prev) => ({
                        ...prev,
                        [currentClipIndex]: displayNewDetectionPrompt.detId,
                      }));
                      setDisplayNewDetectionPrompt(null);
                      setTimeout(() => {
                        const el = document.getElementById(`det-${displayNewDetectionPrompt.detId}`);
                        if (el) {
                          el.scrollIntoView({ behavior: "smooth", block: "center" });
                        }
                      }, 50);
                    }}
                    style={{
                      padding: "6px 10px",
                      borderRadius: "8px",
                      border: "1px solid #1d4ed8",
                      background: "#1d4ed8",
                      color: "#fff",
                      cursor: "pointer",
                      fontWeight: 700,
                    }}
                  >
                    Annotate now
                  </button>
                  <button
                    type="button"
                    onClick={() => setDisplayNewDetectionPrompt(null)}
                    style={{
                      padding: "6px 10px",
                      borderRadius: "8px",
                      border: "1px solid #cbd5e1",
                      background: "#fff",
                      color: "#0f172a",
                      cursor: "pointer",
                      fontWeight: 600,
                    }}
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            )}
            {displayDetections.length === 0 ? (
              <p style={{ marginTop: "8px", color: "#475569" }}>
                Keep watching to see AI detections appear.
              </p>
            ) : (
              <div style={{ marginTop: "8px", display: "flex", flexDirection: "column", gap: "10px" }}>
                {groupedDetections.map((group) => (
                  <div key={group.infoType} style={{ marginBottom: "4px" }}>
                    <div
                      style={{
                        fontWeight: 800,
                        fontSize: "1.05rem",
                        color: "#1d4ed8",
                        marginBottom: "6px",
                      }}
                    >
                      {group.infoType}
                    </div>
                    <ul style={{ listStyle: "none", paddingLeft: 0, margin: 0 }}>
                      {group.list.map((d) => {
                        const answered = isAiResponseComplete(currentAiAnswers[d.det_id]);
                        const isOpen = openDetectionId === d.det_id;
                        return (
                          <li
                            key={`${group.infoType}-${d.det_id}`}
                            id={`det-${d.det_id}`}
                            style={{
                              border: "1px solid #e2e8f0",
                              borderRadius: "8px",
                              marginBottom: "8px",
                              background: "#fff",
                              overflow: "hidden",
                            }}
                          >
                            <div
                              style={{
                                padding: "10px 12px",
                                display: "flex",
                                flexDirection: "column",
                                gap: "6px",
                              }}
                            >
                              <div style={{ display: "flex", justifyContent: "space-between", gap: "8px", alignItems: "center" }}>
                                <strong style={{ color: "#0f172a", flex: 1 }}>{d.detected_visual}</strong>
                                <span style={{ fontSize: "0.85rem", color: "#475569" }}>
                                  {formatTime(d.time_sec || 0)}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => toggleDetection(d.det_id)}
                                  style={{
                                    padding: "6px 10px",
                                    borderRadius: "8px",
                                    border: "1px solid #cbd5e1",
                                    background: "#fff",
                                    cursor: "pointer",
                                    fontWeight: 600,
                                    color: "#0f172a",
                                  }}
                                >
                                  {isOpen ? "Collapse" : "Expand"}
                                </button>
                              </div>
                              <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                                <span
                                  style={{
                                    padding: "4px 8px",
                                    borderRadius: "999px",
                                    background:
                                      answered
                                        ? "#dcfce7"
                                        : displayNewDetectionPrompt?.detId === d.det_id
                                        ? "#fef3c7"
                                        : "#fee2e2",
                                    color:
                                      answered
                                        ? "#166534"
                                        : displayNewDetectionPrompt?.detId === d.det_id
                                        ? "#92400e"
                                        : "#b91c1c",
                                    fontWeight: 700,
                                    fontSize: "0.85rem",
                                  }}
                                >
                                  {answered
                                    ? "Answered"
                                    : displayNewDetectionPrompt?.detId === d.det_id
                                    ? "New privacy threat"
                                    : "Needs answers"}
                                </span>
                              </div>
                            </div>
                            {isOpen && (
                              <div
                                style={{
                                  padding: "10px 12px",
                                  borderTop: "1px solid #e2e8f0",
                                  background: "#f8fafc",
                                  display: "flex",
                                  flexDirection: "column",
                                  gap: "10px",
                                }}
                              >
                                <div style={{ fontSize: "0.95rem", color: "#334155" }}>
                                  {d.why_privacy_sensitive || "Potentially sensitive moment"}
                                </div>
                                <LikertScale
                                  name={`ai-${d.det_id}-threat`}
                                  label="To what extent do you agree that the highlighted content is privacy-threatening for you, if this were your own video?"
                                  value={currentAiAnswers[d.det_id]?.privacy_threat_score}
                                  onChange={(v) => updateAiAnswer(d.det_id, "privacy_threat_score", v)}
                                />
                                <LikertScale
                                  name={`ai-${d.det_id}-share`}
                                  label="To what extent do you agree that you would be willing to share a video that includes this specific content publicly online?"
                                  value={currentAiAnswers[d.det_id]?.share_willingness_score}
                                  onChange={(v) => updateAiAnswer(d.det_id, "share_willingness_score", v)}
                                />
                                <LikertScale
                                  name={`ai-${d.det_id}-remember`}
                                  label="To what extent do you agree that you would be comfortable if an AI assistant detected, stored, and remembered this specific content about you over time?"
                                  value={currentAiAnswers[d.det_id]?.ai_memory_comfort_score}
                                  onChange={(v) => updateAiAnswer(d.det_id, "ai_memory_comfort_score", v)}
                                />
                                <LikertScale
                                  name={`ai-${d.det_id}-trust`}
                                  label="To what extent do you agree that you trust the AI assistant's judgment in this particular case?"
                                  value={currentAiAnswers[d.det_id]?.trust_ai_score}
                                  onChange={(v) => updateAiAnswer(d.det_id, "trust_ai_score", v)}
                                />
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            )}

          <div
            style={{
              marginTop: "14px",
              paddingTop: "12px",
              borderTop: "1px solid #e2e8f0",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px" }}>
              <h3 style={{ margin: 0 }}>AI-suggested detections on multiple scenarios</h3>
              <span
                style={{
                  fontSize: "0.9rem",
                  color: allCrossComplete ? "#065f46" : "#b45309",
                  fontWeight: 700,
                }}
              >
                {crossRequiredCount > 0
                  ? `Answered ${crossCompletedCount} / ${crossRequiredCount}`
                  : "No multi-scenario detections"}
              </span>
            </div>
            {hintMode && hintStepKey === "cross" && (
              <div style={hintBoxStyle}>
                <strong>Cross-clip AI detections</strong>
                <p style={{ margin: "6px 0" }}>
                  When multiple videos are watched, you may also see privacy detections that span across clips.
                  This is a sample of how those results look.
                </p>
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                  <button type="button" style={hintActionStyle} onClick={advanceHint}>
                    Next hint
                  </button>
                </div>
              </div>
            )}
            {crossThreatsForUi.length === 0 ? (
              <p style={{ marginTop: "8px", color: "#475569" }}>
                No multi-scenario AI suggestions available for this story yet.
              </p>
            ) : (
              <ul style={{ listStyle: "none", paddingLeft: 0, margin: "10px 0 0 0" }}>
                {crossThreatsForUi.map((threat, idx) => {
                  const ans = currentCrossAnswers[threat.threat_id || threat.title] || {};
                  const complete = isCrossResponseComplete(ans);
                  return (
                    <li
                      key={threat.threat_id || threat.title || idx}
                      style={{
                        padding: "10px 10px",
                        border: "1px solid #e2e8f0",
                        borderRadius: "8px",
                        marginBottom: "10px",
                        background: "#fff",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" }}>
                        <strong style={{ color: "#0f172a" }}>{threat.title || "Cross-clip threat"}</strong>
                        <span style={{ fontSize: "0.85rem", color: "#475569" }}>
                          Scenarios {Array.isArray(threat.clips_involved) ? threat.clips_involved.join(", ") : "n/a"}
                        </span>
                        <span
                          style={{
                            padding: "4px 8px",
                            borderRadius: "999px",
                            background: complete ? "#dcfce7" : "#fee2e2",
                            color: complete ? "#166534" : "#b91c1c",
                            fontSize: "0.8rem",
                            fontWeight: 700,
                          }}
                        >
                          {complete ? "Answered" : "Needs answers"}
                        </span>
                      </div>
                      {threat.why_amplified_across_clips && (
                        <div style={{ fontSize: "0.95rem", color: "#334155", marginTop: "4px" }}>
                          {threat.why_amplified_across_clips}
                        </div>
                      )}
                      <div style={{ fontSize: "0.9rem", color: "#475569", marginTop: "6px" }}>
                        Info types: {formatList(threat.information_types) || "n/a"}
                      </div>
                      {threat.evidence_summary && (
                        <div style={{ fontSize: "0.85rem", color: "#475569", marginTop: "4px" }}>
                          Evidence: {threat.evidence_summary}
                        </div>
                      )}

                      <div style={{ marginTop: "10px", display: "flex", flexDirection: "column", gap: "8px" }}>
                        <LikertScale
                          name={`cross-${threat.threat_id || idx}-threat`}
                          label="To what extent do you agree that this content is privacy-threatening for you?"
                          value={ans.cross_privacy_threat_score}
                          onChange={(v) =>
                            updateCrossAnswer(threat.threat_id || threat.title, "cross_privacy_threat_score", v)
                          }
                        />
                        <LikertScale
                          name={`cross-${threat.threat_id || idx}-severity`}
                          label="To what extent do you agree that this detection across multiple video clips has more severe privacy threats than detection in single clips?"
                          value={ans.cross_more_severe_score}
                          onChange={(v) =>
                            updateCrossAnswer(threat.threat_id || threat.title, "cross_more_severe_score", v)
                          }
                        />
                        <LikertScale
                          name={`cross-${threat.threat_id || idx}-ai-memory`}
                          label="Imagine you use an AI assistant that continuously analyzes your daily life. To what extent do you agree that you would be comfortable if this AI detected, stored, and remembered this content about you over its long-term usage?"
                          value={ans.cross_ai_memory_comfort_score}
                          onChange={(v) =>
                            updateCrossAnswer(threat.threat_id || threat.title, "cross_ai_memory_comfort_score", v)
                          }
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          </div>
        )}
      </div>

      {renderFeedback({ showStatus: !isTestMode })}

      <div
        style={{
          ...sectionHintStyle("manual"),
          border: "1px solid #e2e8f0",
          borderRadius: "10px",
          padding: "12px",
          marginTop: "12px",
        }}
      >
        {hintMode && hintStepKey === "manual" && (
          <div style={hintBoxStyle}>
            <strong>Create your own annotations</strong>
            <p style={{ margin: "6px 0" }}>
              You can add privacy-related content that the AI did not detect. Use these cards to capture anything else
              you notice.
            </p>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              <button type="button" style={hintActionStyle} onClick={advanceHint}>
                Next hint
              </button>
            </div>
          </div>
        )}
        {hintMode && hintStepKey === "finish" && (
          <div style={hintBoxStyle}>
            <strong>Ready for the real annotation task</strong>
            <p style={{ margin: "6px 0" }}>
              You can return to this hint page anytime using “View annotation hint.” Click below when you’re ready to
              start the real annotation task.
            </p>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              <button type="button" style={hintActionStyle} onClick={finishHintFlow}>
                Start real annotation
              </button>
            </div>
          </div>
        )}
        <h3 style={{ fontSize: "1.15rem", marginBottom: "6px" }}>
          {isVlmMode
            ? "Do you see anything else (not included in the AI detections) that could reveal privacy-related information?"
            : "Do you see anything in this video that could reveal privacy-related information?"}
        </h3>
        <p style={{ fontSize: "0.95rem", marginBottom: "10px", color: "#334155" }}>
          Select all that apply. If nothing seems sensitive, choose “I do not see any privacy-related content.”
          You can add multiple privacy threats.
        </p>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "12px",
            alignItems: "start",
            marginBottom: "12px",
          }}
        >
          {CATEGORY_OPTIONS.map((opt) => {
            const count = manualCategoryCounts[opt.value] || 0;
            const isNone = opt.value === "none";
            const cardsForCategory = currentManualFindings.filter((f) =>
              f.categories?.includes(opt.value)
            );
            const canAdd = isNone ? count === 0 : true;
            return (
              <div
                key={opt.value}
                style={{
                  padding: "10px",
                  border: "1px solid #e2e8f0",
                  borderRadius: "12px",
                  background: "#fff",
                  display: "flex",
                  flexDirection: "column",
                  gap: "10px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <div style={{ flex: 1, color: "#0f172a", textAlign: "left" }}>{opt.label}</div>
                  {!isNone && (
                    <>
                      <span
                        style={{
                          minWidth: "28px",
                          textAlign: "center",
                          padding: "4px 8px",
                          borderRadius: "8px",
                          border: "1px solid #cbd5e1",
                          background: "#f8fafc",
                          fontWeight: 700,
                        }}
                      >
                        {count}
                      </span>
                      <button
                        type="button"
                        onClick={() => canAdd && addManualFinding(opt.value)}
                        style={{
                          padding: "8px 10px",
                          borderRadius: "12px",
                          border: "1px solid #1d4ed8",
                          background: "#1d4ed8",
                          color: "#fff",
                          cursor: "pointer",
                          fontWeight: 800,
                          minWidth: "42px",
                        }}
                      >
                        +
                      </button>
                    </>
                  )}
                  {isNone && canAdd && (
                    <button
                      type="button"
                      onClick={() => addManualFinding(opt.value)}
                      style={{
                        padding: "8px 10px",
                        borderRadius: "12px",
                        border: "1px solid #1d4ed8",
                        background: "#1d4ed8",
                        color: "#fff",
                        cursor: "pointer",
                        fontWeight: 800,
                      }}
                    >
                      Yes
                    </button>
                  )}
                </div>

                {cardsForCategory.map((f, cardIdx) => {
                  const complete = isFindingComplete(f);
                  const expanded = expandedManualId === f.finding_id;
                  const label = categoryLabelMap[opt.value] || "Privacy threat";
                  return (
                    <div
                      key={f.finding_id}
                      style={{
                        padding: "10px",
                        border: "1px solid #e2e8f0",
                        borderRadius: "10px",
                        background: "#f8fafc",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                        <strong style={{ color: "#0f172a" }}>
                          {label} #{cardIdx + 1}
                        </strong>
                        <span
                          style={{
                            padding: "4px 8px",
                            borderRadius: "999px",
                            background: complete ? "#dcfce7" : "#fee2e2",
                            color: complete ? "#166534" : "#b91c1c",
                            fontSize: "0.85rem",
                            fontWeight: 700,
                          }}
                        >
                          {complete ? "Complete" : "Needs answers"}
                        </span>
                        <div style={{ marginLeft: "auto", display: "flex", gap: "8px" }}>
                          <button
                            type="button"
                            onClick={() => toggleManualExpand(f.finding_id)}
                            style={{
                              padding: "6px 10px",
                              borderRadius: "8px",
                              border: "1px solid #cbd5e1",
                              background: "#fff",
                              color: "#0f172a",
                              cursor: "pointer",
                              fontWeight: 600,
                            }}
                          >
                            {expanded ? "Collapse" : "Expand"}
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteManualFinding(f.finding_id)}
                            style={{
                              padding: "6px 10px",
                              borderRadius: "8px",
                              border: "1px solid #e11d48",
                              background: "#fff",
                              color: "#e11d48",
                              cursor: "pointer",
                              fontWeight: 600,
                            }}
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                      {!expanded && (
                        <div style={{ color: "#475569", fontSize: "0.9rem", marginTop: "6px" }}>
                          {f.description || "No description yet."}
                        </div>
                      )}
                      {expanded && (
                        <div style={{ marginTop: "10px", display: "flex", flexDirection: "column", gap: "10px" }}>
                              <label style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                            <span style={{ fontWeight: 700 }}>
                              {opt.value === "none"
            ? "Please tell us why you do not see any privacy-related content."
            : "Please briefly describe what this content is."}
                            </span>
                            <textarea
                              rows={3}
                              value={f.description}
                              onChange={(e) => updateManualField(f.finding_id, "description", e.target.value)}
                              style={{
                                width: "100%",
                                padding: "8px",
                                borderRadius: "8px",
                                border: "1px solid #cbd5e1",
                              }}
                            />
                          </label>
                          {opt.value === "other" && (
                            <label style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                              <span style={{ fontWeight: 700 }}>Other (please specify)</span>
                              <input
                                type="text"
                                value={f.other_text || ""}
                                onChange={(e) => updateManualField(f.finding_id, "other_text", e.target.value)}
                                style={{
                                  width: "100%",
                                  padding: "8px",
                                  borderRadius: "8px",
                                  border: "1px solid #cbd5e1",
                                }}
                              />
                            </label>
                          )}

                          {opt.value !== "none" && (
                            <>
                              <LikertScale
                                name={`manual-${f.finding_id}-threat`}
                                label="To what extent do you agree that this content is privacy-threatening for you?"
                                value={f.privacy_threat_score}
                                onChange={(v) => updateManualField(f.finding_id, "privacy_threat_score", v)}
                              />
                              <LikertScale
                                name={`manual-${f.finding_id}-share`}
                                label="To what extent do you agree that you would be willing to share a video that includes this content publicly online?"
                                value={f.share_willingness_score}
                                onChange={(v) => updateManualField(f.finding_id, "share_willingness_score", v)}
                              />
                              <LikertScale
                                name={`manual-${f.finding_id}-ai`}
                                label="Imagine you use an AI assistant that continuously analyzes your daily life. To what extent do you agree that you would be comfortable if this AI detected, stored, and remembered this content about you over time?"
                                value={f.ai_memory_comfort_score}
                                onChange={(v) => updateManualField(f.finding_id, "ai_memory_comfort_score", v)}
                              />
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
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
                X
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

      {false && (
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
              <li>Review the AI's suggestions.</li>
              <li>Correct them if needed.</li>
              <li>Add any privacy-sensitive moments the AI may have missed.</li>
            </ul>
            <p>
              The AI suggestions are not always complete or accurate; your own judgment is essential. Please take your
              time and provide your own input in addition to reviewing the AI's output. Your feedback will help us
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
