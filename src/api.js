const API_BASE = import.meta.env.VITE_API_BASE_URL; // e.g. https://<api-id>.execute-api.ap-northeast-1.amazonaws.com

export async function assignParticipant(participantId) {
  const res = await fetch(`${API_BASE}/assign`, {
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
  const res = await fetch(`${API_BASE}/assignTest`, {
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
  const res = await fetch(`${API_BASE}/presign`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ operation: "get", key }),
  });
  if (!res.ok) throw new Error(`presignGet failed: ${res.status}`);
  const data = await res.json();
  return data.url;
}
