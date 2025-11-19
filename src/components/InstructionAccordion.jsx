// src/components/InstructionAccordion.jsx
import React from 'react';

export default function InstructionAccordion() {
  return (
    <details className="card" open>
      <summary><strong>Study Instructions</strong></summary>
      <p>
        In this study, you will watch short first-person video clips and identify content that could
        be privacy-sensitive. Depending on the condition, you may see suggestions from an AI system.
      </p>
      <ol>
        <li>Enter your Prolific ID to start or resume your assignment.</li>
        <li>For each clip, review the video and record privacy-relevant items.</li>
        <li>In AI-assisted mode, you can accept suggested detections or add your own.</li>
        <li>Move to the next clip when you are satisfied with your annotations.</li>
      </ol>
      <hr />
      <p><em>Optional awareness questions (for your own logs):</em></p>
      <ul>
        <li>How comfortable are you sharing first-person videos online? (1–7)</li>
        <li>Have you used wearable cameras before? (Yes/No)</li>
        <li>Give an example of something you would not want in a shared video.</li>
      </ul>
    </details>
  );
}
