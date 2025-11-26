// src/api.js

const ASSIGN_URL = import.meta.env.VITE_ASSIGN_URL;
const PRESIGN_URL = import.meta.env.VITE_PRESIGN_URL;
const MARK_FINISHED_URL = import.meta.env.VITE_MARK_FINISHED_URL;

if (!ASSIGN_URL || !PRESIGN_URL || !MARK_FINISHED_URL) {
  console.warn("One or more API URLs are missing in env (.env.local).");
}

export async function assignParticipant(participantId) {
  const res = await fetch(ASSIGN_URL, {
    method: "POST",
    body: JSON.stringify({ participantId })
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Assign failed: ${res.status} ${text}`);
  }

  return res.json();
}


export async function presignGet(key) {
  const res = await fetch(PRESIGN_URL, {
    method: "POST",
    body: JSON.stringify({ operation: "get", key })
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Presign GET failed: ${res.status} ${text}`);
  }

  const data = await res.json();
  return data.url;
}

export async function presignPut(key, contentType = "application/json") {
  const res = await fetch(PRESIGN_URL, {
    method: "POST",
    body: JSON.stringify({ operation: "put", key, contentType })
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Presign PUT failed: ${res.status} ${text}`);
  }

  const data = await res.json();
  return data.url;
}

export async function markFinished(participantId) {
  const res = await fetch(MARK_FINISHED_URL, {
    method: "POST",
    body: JSON.stringify({ participantId })
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`markFinished failed: ${res.status} ${text}`);
  }

  return res.json();
}
