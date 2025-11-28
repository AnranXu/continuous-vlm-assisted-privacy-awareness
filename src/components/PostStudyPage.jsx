// src/components/PostStudyPage.jsx
import React, { useMemo, useState } from "react";

const likertOptions = [1, 2, 3, 4, 5, 6, 7];
const optionLabels = {
  1: "Not at all",
  4: "Moderate",
  7: "Extremely",
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

export default function PostStudyPage({ onSubmit, saving = false, feedback = null }) {
  const [answers, setAnswers] = useState(() => {
    const initial = {};
    QUESTION_DEFS.forEach((q) => {
      initial[q.id] = null;
    });
    return initial;
  });
  const [freeText, setFreeText] = useState("");

  const allAnswered = useMemo(() => QUESTION_DEFS.every((q) => answers[q.id] !== null), [answers]);

  const handleChoice = (qid, value) => {
    setAnswers((prev) => ({ ...prev, [qid]: value }));
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
        <p style={{ marginBottom: 0 }}>Use a 7-point scale with anchors 1 = Not at all · 7 = Extremely.</p>
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
              <span style={{ padding: "4px 8px", background: "#f1f5f9", borderRadius: "6px" }}>1 = Not at all</span>
              <span style={{ padding: "4px 8px", background: "#f1f5f9", borderRadius: "6px" }}>
                7 = Extremely
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
                    <div style={{ fontWeight: 700, color: "#0f172a", marginBottom: "4px" }}>{q.title}</div>
                    <div style={{ lineHeight: 1.5 }}>{q.text}</div>
                  </div>
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
                        border: answers[q.id] === value ? "2px solid #0ea5e9" : "1px solid #cbd5e1",
                        borderRadius: "10px",
                        padding: "8px 6px",
                        textAlign: "center",
                        cursor: "pointer",
                        background: answers[q.id] === value ? "#e0f2fe" : "#f8fafc",
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
