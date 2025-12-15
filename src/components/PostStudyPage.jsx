// src/components/PostStudyPage.jsx
import React, { useMemo, useState } from "react";

const likertOptions = Array.from({ length: 21 }, (_, idx) => idx + 1);
const tickLabels = {
  1: "Very Low",
  11: "Medium",
  21: "Very High",
};

const AI_LIKERT_OPTIONS = [-3, -2, -1, 0, 1, 2, 3];
const aiOptionLabels = {
  "-3": "Strongly disagree (-3)",
  "0": "neutral (0)",
  "3": "strongly agree (3)",
};

const QUESTION_DEFS = [
  {
    id: "mental_demand",
    title: "Mental demand",
    text: "To what extent do you agree that the task required a high level of mental effort or concentration?",
  },
  {
    id: "physical_demand",
    title: "Physical demand",
    text: "To what extent do you agree that the task was physically demanding (for example, eye strain, mouse or keyboard use)?",
  },
  {
    id: "time_pressure",
    title: "Time pressure",
    text: "To what extent do you agree that you felt rushed or under time pressure while doing the task?",
  },
  {
    id: "performance",
    title: "Perceived performance",
    text: "To what extent do you agree that you performed the task well? (higher = better performance)",
  },
  {
    id: "effort",
    title: "Effort",
    text: "To what extent do you agree that you had to put a lot of effort into completing the task?",
  },
  {
    id: "frustration",
    title: "Frustration",
    text: "To what extent do you agree that you felt annoyed, stressed, or frustrated while doing the task?",
  },
];

const AI_QUESTION_DEFS = [
  {
    id: "ai_highlights_easier",
    title: "AI highlights help notice privacy risks",
    text: "To what extent do you agree that the AI highlights made it easier to notice potentially privacy-threatening content?",
  },
  {
    id: "ai_highlights_distracting",
    title: "AI highlights were distracting",
    text: "To what extent do you agree that the AI highlights sometimes distracted you from what you considered important?",
  },
  {
    id: "ai_trust_assistant",
    title: "Trust AI to protect privacy",
    text: "To what extent do you agree that, in general, you would trust an AI system to help you protect your privacy in everyday life?",
  },
  {
    id: "ai_feel_in_control",
    title: "Control with constant AI analysis",
    text: "To what extent do you agree that you would still feel in control of what is shared, even if an AI assistant is constantly analyzing your video?",
  },
];

export default function PostStudyPage({ onSubmit, saving = false, feedback = null, mode = "" }) {
  const isAiMode = (mode || "").toLowerCase() === "vlm";
  const [answers, setAnswers] = useState(() => {
    const initial = {};
    QUESTION_DEFS.forEach((q) => {
      initial[q.id] = null;
    });
    return initial;
  });
  const [aiAnswers, setAiAnswers] = useState(() => {
    const initial = {};
    AI_QUESTION_DEFS.forEach((q) => {
      initial[q.id] = null;
    });
    return initial;
  });
  const [freeText, setFreeText] = useState("");

  const allAnswered = useMemo(() => {
    const baseComplete = QUESTION_DEFS.every((q) => answers[q.id] !== null);
    const aiComplete = !isAiMode || AI_QUESTION_DEFS.every((q) => aiAnswers[q.id] !== null);
    return baseComplete && aiComplete;
  }, [answers, aiAnswers, isAiMode]);

  const handleChoice = (qid, value, isAi = false) => {
    if (isAi) {
      setAiAnswers((prev) => ({ ...prev, [qid]: value }));
    } else {
      setAnswers((prev) => ({ ...prev, [qid]: value }));
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!allAnswered || saving) return;
    const payload = {
      answers: QUESTION_DEFS.map((q, idx) => ({
        id: q.id,
        index: idx + 1,
        title: q.title,
        question: q.text,
        score: answers[q.id],
      })),
      aiAnswers: isAiMode
        ? AI_QUESTION_DEFS.map((q, idx) => ({
            id: q.id,
            index: idx + 1,
            title: q.title,
            question: q.text,
            score: aiAnswers[q.id],
          }))
        : [],
      freeText,
    };
    if (onSubmit) onSubmit(payload);
  };

  return (
    <div className="container" style={{ gap: "16px", display: "flex", flexDirection: "column" }}>
      <div className="card" style={{ fontSize: "1.05rem", lineHeight: 1.55 }}>
        <h2 style={{ marginTop: 0, marginBottom: "10px" }}>Post-study: task feedback</h2>
        <p style={{ marginBottom: "6px" }}>
          The following questions ask about the task you just completed (watching egocentric video and answering
          questions). Please rate each statement.
        </p>
        <p style={{ marginBottom: "6px" }}>
          Use a 21-point discrete scale with anchors 1 = Very Low · 21 = Very High.
        </p>
        <p style={{ marginBottom: 0, fontWeight: 600 }}>
          Click directly on one of the 21 vertical tick marks to choose your answer for each statement.
        </p>
      </div>

      <div className="card" style={{ padding: "16px" }}>
        <form onSubmit={handleSubmit}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "10px",
              flexWrap: "wrap",
              gap: "8px",
            }}
          >
            <div style={{ fontWeight: 600 }}>Please choose one option per statement.</div>
            <div
              style={{
                display: "flex",
                gap: "10px",
                fontSize: "0.9rem",
                color: "#0f172a",
                alignItems: "center",
              }}
            >
              <span style={{ padding: "4px 8px", background: "#f1f5f9", borderRadius: "6px" }}>1 = Very Low</span>
              <span style={{ padding: "4px 8px", background: "#f1f5f9", borderRadius: "6px" }}>
                21 = Very High
              </span>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            {QUESTION_DEFS.map((q, idx) => (
              <div
                key={q.id}
                style={{
                  border: "1px solid #e2e8f0",
                  borderRadius: "10px",
                  padding: "10px 12px",
                  background: "#fff",
                  boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
                }}
              >
                <div style={{ display: "flex", gap: "10px", alignItems: "flex-start", marginBottom: "8px" }}>
                  <div
                    style={{
                      minWidth: "28px",
                      height: "28px",
                      borderRadius: "8px",
                      background: "#e0f2fe",
                      color: "#0284c7",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontWeight: 700,
                    }}
                  >
                    {idx + 1}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ lineHeight: 1.5 }}>{q.text}</div>
                  </div>
                </div>

                <div
                  style={{
                    position: "relative",
                    padding: "12px 16px 64px 16px",
                    overflowX: "auto",
                  }}
                >
                  <div
                    style={{
                      position: "absolute",
                      left: "16px",
                      right: "16px",
                      top: "12px",
                      height: "3px",
                      background: "#e2e8f0",
                      zIndex: 0,
                    }}
                  />

                  <div
                    style={{
                    display: "grid",
                    gridTemplateColumns: `repeat(${likertOptions.length}, minmax(26px, 1fr))`,
                    alignItems: "flex-end",
                    gap: "8px",
                    position: "relative",
                    zIndex: 1,
                  }}
                >
                  {likertOptions.map((value) => {
                      const selected = answers[q.id] === value;
                      const label = tickLabels[value];
                      const isAnchor = Boolean(label);
                      const isFirst = value === 1;
                      const isLast = value === likertOptions.length;
                      const labelTransform = isFirst
                        ? "translateX(-20%)"
                        : isLast
                        ? "translateX(-80%)"
                        : "translateX(-50%)";
                      return (
                        <label
                          key={`${q.id}_${value}`}
                          style={{
                            position: "relative",
                            display: "flex",
                            justifyContent: "center",
                            alignItems: "flex-end",
                            cursor: "pointer",
                            minWidth: "26px",
                            height: "40px",
                          }}
                        >
                          <input
                            type="radio"
                            name={q.id}
                            value={value}
                            checked={selected}
                            onChange={() => handleChoice(q.id, value)}
                            style={{ position: "absolute", opacity: 0, width: 0, height: 0 }}
                          />
                          <div
                            style={{
                              width: isAnchor ? "3px" : "2.5px",
                              height: isAnchor ? "24px" : "16px",
                              background: selected ? "#0ea5e9" : "#0f172a",
                              borderRadius: "2px",
                            }}
                          />
                          {label ? (
                            <div
                              style={{
                                position: "absolute",
                                top: "46px",
                                left: "50%",
                                transform: labelTransform,
                                whiteSpace: "nowrap",
                                fontSize: "0.82rem",
                                fontWeight: selected ? 700 : 600,
                                color: selected ? "#0ea5e9" : "#475569",
                              }}
                            >
                              {label}
                            </div>
                          ) : null}
                        </label>
                      );
                    })}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {isAiMode && (
            <div
              className="card"
              style={{
                marginTop: "16px",
                border: "1px solid #e2e8f0",
                borderRadius: "10px",
                padding: "12px 12px 14px",
                background: "#f8fafc",
                boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
              }}
            >
              <div style={{ fontWeight: 800, color: "#0f172a", marginBottom: "6px" }}>
                Your thoughts on AI detection of privacy risks in egocentric videos
              </div>
              <div style={{ color: "#334155", marginBottom: "10px", lineHeight: 1.5 }}>
                Please answer these questions (1 = strongly disagree, 7 = strongly agree).
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                {AI_QUESTION_DEFS.map((q, idx) => (
                  <div
                    key={q.id}
                    style={{
                      border: "1px solid #e2e8f0",
                      borderRadius: "10px",
                      padding: "10px 12px",
                      background: "#fff",
                      boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
                    }}
                  >
                    <div style={{ display: "flex", gap: "10px", alignItems: "flex-start", marginBottom: "8px" }}>
                      <div
                        style={{
                          minWidth: "28px",
                          height: "28px",
                          borderRadius: "8px",
                          background: "#ede9fe",
                          color: "#7c3aed",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontWeight: 700,
                        }}
                      >
                        {idx + 1}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ lineHeight: 1.45 }}>{q.text}</div>
                      </div>
                    </div>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(7, minmax(110px, 1fr))",
                        gap: "8px",
                        width: "100%",
                        overflowX: "auto",
                      }}
                    >
                      {AI_LIKERT_OPTIONS.map((value) => {
                        const selected = aiAnswers[q.id] === value;
                        return (
                          <label
                            key={`${q.id}_${value}`}
                            style={{
                              border: selected ? "2px solid #7c3aed" : "1px solid #cbd5e1",
                              borderRadius: "10px",
                              padding: "10px 6px",
                              textAlign: "center",
                              cursor: "pointer",
                              background: selected ? "#f3e8ff" : "#f8fafc",
                              fontWeight: selected ? 700 : 600,
                              color: "#0f172a",
                              minWidth: "70px",
                              boxShadow: selected ? "0 1px 4px rgba(124,58,237,0.25)" : "none",
                            }}
                          >
                            <input
                              type="radio"
                              name={`ai_${q.id}`}
                              value={value}
                              checked={selected}
                              onChange={() => handleChoice(q.id, value, true)}
                              style={{ display: "none" }}
                            />
                            <div style={{ fontSize: "0.95rem", whiteSpace: "nowrap" }}>
                              {aiOptionLabels[value] || value}
                            </div>
                          </label>
                        );
                      })}
                    </div>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        marginTop: "8px",
                    fontSize: "0.9rem",
                    color: "#475569",
                  }}
                >
                  <span>Strongly disagree (-3)</span>
                  <span>neutral (0)</span>
                  <span>strongly agree (3)</span>
                </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={{ marginTop: "16px" }}>
            <label htmlFor="postFreeText" style={{ fontWeight: 700, display: "block", marginBottom: "6px" }}>
              What do you want to share about privacy issues in egocentric videos in the AI era?
            </label>
            <textarea
              id="postFreeText"
              value={freeText}
              onChange={(e) => setFreeText(e.target.value)}
              rows={4}
              style={{
                width: "100%",
                borderRadius: "10px",
                border: "1px solid #cbd5e1",
                padding: "10px",
                fontSize: "1rem",
                resize: "vertical",
                background: "#fff",
              }}
              placeholder="Your thoughts..."
            />
          </div>

          <div
            style={{
              marginTop: "14px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: "10px",
            }}
          >
            <div style={{ color: allAnswered ? "#0f172a" : "#b91c1c" }}>
              {allAnswered ? "All ratings complete." : "Please answer every question before finishing."}
            </div>
            <button
              type="submit"
              disabled={!allAnswered || saving}
              style={{
                padding: "10px 16px",
                borderRadius: "10px",
                border: "1px solid #0ea5e9",
                background: !allAnswered || saving ? "#cbd5e1" : "#0ea5e9",
                color: !allAnswered || saving ? "#475569" : "#fff",
                cursor: !allAnswered || saving ? "not-allowed" : "pointer",
                fontWeight: 700,
                minWidth: "240px",
              }}
            >
              {saving ? "Submitting..." : "Finish and get completion link"}
            </button>
          </div>
        </form>
      </div>

      {feedback}
    </div>
  );
}
