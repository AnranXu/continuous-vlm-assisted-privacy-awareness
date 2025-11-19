// src/api.js
const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8080';

// Assign participant and get story info for first clip
export async function assignParticipant(participantId, storyId) {
  const res = await fetch(`${API_BASE}/api/assign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ participantId, storyId }),
  });
  if (!res.ok) throw new Error('Failed to assign participant');
  return res.json();
}

// Load current assignment for resume flow
export async function readAssignment(participantId) {
  const res = await fetch(`${API_BASE}/api/assignment/${participantId}`);
  if (!res.ok) throw new Error('Failed to read assignment');
  return res.json();
}

// Presign a PUT or GET URL for S3
export async function presign(key, method, contentType) {
  const res = await fetch(`${API_BASE}/api/presign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, method, contentType }),
  });
  if (!res.ok) throw new Error('Failed to presign');
  return res.json();
}

// Save assignment/progress back to S3
export async function saveProgress(participantId, assignment) {
  const res = await fetch(`${API_BASE}/api/progress`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ participantId, assignment }),
  });
  if (!res.ok) throw new Error('Failed to save progress');
  return res.json();
}
