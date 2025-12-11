// src/components/PreStudyPage.jsx
import React, { useMemo, useState } from "react";

const likertOptions = [-3, -2, -1, 0, 1, 2, 3];
const optionLabels = {
  "-3": "Strongly disagree",
  "0": "Neutral",
  "3": "Strongly agree",
};

const QUESTION_DEFS = [
  {
    id: "q1",
    text: "I understand the basic ideas behind how AI systems work (for example, that they learn patterns from data).",
  },
  {
    id: "q2",
    text: "I am familiar with common uses of AI in everyday life (for example, recommendations, voice assistants, or image analysis).",
  },
  {
    id: "q3",
    text: "I feel able to judge, in a rough way, what current AI systems can and cannot do.",
  },
  {
    id: "q4",
    text: "I feel confident that I could learn to use a new AI-based app or device if I needed it.",
  },
  {
    id: "q5",
    text: "I worry about how AI systems might collect and use my personal data.",
  },
  {
    id: "q6",
    text: "I am concerned that AI systems could infer sensitive things about me (for example, my habits, beliefs, or health) from seemingly harmless data.",
  },
  {
    id: "q7",
    text: "It is important to me to have control over what personal data AI systems can access and how long they keep it.",
  },
  {
    id: "q8",
    text: "I feel uneasy when AI services share my data or recordings with companies or other organizations.",
  },
  {
    id: "q9",
    text: "I am especially concerned about AI systems that continuously sense my environment (for example, through cameras or microphones).",
  },
  {
    id: "q10",
    text: "Even if an AI service is convenient, I would still hesitate to use it if it collects detailed data about my daily life.",
  },
];

export default function PreStudyPage({ onSubmit, saving = false, feedback = null }) {
  const [answers, setAnswers] = useState(() => {
    const initial = {};
    QUESTION_DEFS.forEach((q) => {
      initial[q.id] = null;
    });
    return initial;
  });

  const allAnswered = useMemo(
    () => QUESTION_DEFS.every((q) => answers[q.id] !== null),
    [answers]
  );

  const handleChoice = (qid, value) => {
    setAnswers((prev) => ({ ...prev, [qid]: value }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!allAnswered || saving) return;
    const payload = QUESTION_DEFS.map((q, idx) => ({
      id: q.id,
      index: idx + 1,
      question: q.text,
      score: answers[q.id],
    }));
    if (onSubmit) onSubmit(payload);
  };

  return (
    <div className="container" style={{ gap: "16px", display: "flex", flexDirection: "column" }}>
      <div className="card" style={{ fontSize: "1.05rem", lineHeight: 1.55 }}>
        <h2 style={{ marginTop: 0, marginBottom: "10px" }}>Pre-study: your view on AI assistants</h2>
        <p style={{ marginBottom: "12px" }}>
          In this study, we first ask you to think about a possible future <strong>AI assistant</strong> that can <strong>continuously see</strong> what
          you see through a wearable camera (for example in smart glasses) and provide helps. It can recognize objects,
          locations, and people, and keep a memory of what it has seen to offer reminders and suggestions. It does not
          read your mind or hear private thoughts, but it could help you sort receipts, remember where you left things,
          or assist you during your work, etc.
        </p>
        <p style={{ marginBottom: 0 }}>
          We would like to know how much degree you agree with the following statements:
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
            <div style={{ fontWeight: 600 }}>Please choose one option per statement (7-point scale).</div>
            <div
              style={{
                display: "flex",
                gap: "10px",
                fontSize: "0.9rem",
                color: "#0f172a",
                alignItems: "center",
              }}
            >
              <span style={{ padding: "4px 8px", background: "#f1f5f9", borderRadius: "6px" }}>
                -3 = Strongly disagree
              </span>
              <span style={{ padding: "4px 8px", background: "#f1f5f9", borderRadius: "6px" }}>0 = Neutral</span>
              <span style={{ padding: "4px 8px", background: "#f1f5f9", borderRadius: "6px" }}>
                3 = Strongly agree
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
                      background: "#e0e7ff",
                      color: "#1d4ed8",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontWeight: 700,
                    }}
                  >
                    {idx + 1}
                  </div>
                  <div style={{ flex: 1, lineHeight: 1.5 }}>{q.text}</div>
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(7, minmax(70px, 1fr))",
                    gap: "6px",
                    width: "100%",
                    overflowX: "auto",
                  }}
                >
                  {likertOptions.map((value) => (
                    <label
                      key={`${q.id}_${value}`}
                      style={{
                        border: answers[q.id] === value ? "2px solid #1d4ed8" : "1px solid #cbd5e1",
                        borderRadius: "10px",
                        padding: "8px 6px",
                        textAlign: "center",
                        cursor: "pointer",
                        background: answers[q.id] === value ? "#eef2ff" : "#f8fafc",
                        fontWeight: answers[q.id] === value ? 700 : 500,
                        color: "#0f172a",
                      }}
                    >
                      <input
                        type="radio"
                        name={q.id}
                        value={value}
                        checked={answers[q.id] === value}
                        onChange={() => handleChoice(q.id, value)}
                        style={{ display: "none" }}
                      />
                      <div style={{ fontSize: "0.95rem" }}>{optionLabels[value] || value}</div>
                    </label>
                  ))}
                </div>
              </div>
            ))}
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
              {allAnswered ? "All questions answered." : "Please answer every question before continuing."}
            </div>
            <button
              type="submit"
              disabled={!allAnswered || saving}
              style={{
                padding: "10px 16px",
                borderRadius: "10px",
                border: "1px solid #1d4ed8",
                background: !allAnswered || saving ? "#cbd5e1" : "#1d4ed8",
                color: !allAnswered || saving ? "#475569" : "#fff",
                cursor: !allAnswered || saving ? "not-allowed" : "pointer",
                fontWeight: 700,
                minWidth: "220px",
              }}
            >
              {saving ? "Saving responses..." : "Continue to annotation task"}
            </button>
          </div>
        </form>
      </div>

      {feedback}
    </div>
  );
}
