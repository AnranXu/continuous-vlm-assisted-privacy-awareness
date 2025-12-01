// Normalize once so callers don't need to worry about missing or extra slashes.
const API_BASE = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, ""); // e.g. https://<api-id>.execute-api.ap-northeast-1.amazonaws.com

function buildUrl(path) {
  if (!API_BASE) {
    throw new Error(
      "API base URL is not configured. Set VITE_API_BASE_URL in .env.local (e.g. https://<api-id>.execute-api.ap-northeast-1.amazonaws.com)"
    );
  }
  return `${API_BASE}${path}`;
}

export async function assignParticipant(participantId) {
  const res = await fetch(buildUrl("/assign"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ participantId }),
  });
  if (!res.ok) {
    throw new Error(`Assign failed: ${res.status}`);
  }
  return res.json();
}

export async function assignTestParticipant({ participantId, storyIndex, mode }) {
  const res = await fetch(buildUrl("/assignTest"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ participantId, storyIndex, mode }),
  });
  if (!res.ok) {
    throw new Error(`AssignTest failed: ${res.status}`);
  }
  return res.json();
}

export async function presignGet(key) {
  const res = await fetch(buildUrl("/presign"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ operation: "get", key }),
  });
  if (!res.ok) throw new Error(`presignGet failed: ${res.status}`);
  const data = await res.json();
  return data.url;
}

export async function submitPreStudy(payload) {
  const res = await fetch(buildUrl("/prestudy"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`Pre-study submit failed: ${res.status}`);
  }
  return res.json();
}

export async function fetchStudyStatus(participantId) {
  const res = await fetch(buildUrl("/status"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ participantId }),
  });
  if (!res.ok) {
    throw new Error(`Status fetch failed: ${res.status}`);
  }
  return res.json();
}

export async function submitPostStudy(payload) {
  const res = await fetch(buildUrl("/poststudy"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`Post-study submit failed: ${res.status}`);
  }
  return res.json();
}

export async function submitClipAnnotation(payload) {
  const res = await fetch(buildUrl("/clipAnnotation"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`Clip annotation submit failed: ${res.status}`);
  }
  return res.json();
}

export async function updateStage(participantId, stage) {
  const res = await fetch(buildUrl("/stage"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ participantId, stage }),
  });
  if (!res.ok) {
    throw new Error(`Stage update failed: ${res.status}`);
  }
  return res.json();
}

export async function markFinished(participantId) {
  const res = await fetch(buildUrl("/markFinished"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ participantId }),
  });
  if (!res.ok) {
    throw new Error(`Mark finished failed: ${res.status}`);
  }
  return res.json();
}
