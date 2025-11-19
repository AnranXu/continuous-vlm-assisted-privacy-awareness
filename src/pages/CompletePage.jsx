// src/pages/CompletePage.jsx
import React from 'react';
import { useStore } from '../store';

export default function CompletePage() {
  const { prolificCompletionUrl } = useStore();
  const url = prolificCompletionUrl || 'https://app.prolific.co/';

  return (
    <div className="container">
      <h2>Thank you!</h2>
      <p>You have completed all clips for this story.</p>
      <p>Please click below to return to Prolific and confirm your participation.</p>
      <a className="button" href={url}>
        Return to Prolific
      </a>
    </div>
  );
}
