import {
  DynamoDBClient,
  PutItemCommand
} from "@aws-sdk/client-dynamodb";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";

const ddb = new DynamoDBClient({});
const s3 = new S3Client({});

const TABLE = process.env.ASSIGN_TABLE;
const CONFIG_BUCKET = process.env.CONFIG_BUCKET;
const CONFIG_KEY = process.env.CONFIG_KEY || "study_config.json";
const DEFAULT_FORMAL_STUDY = process.env.DEFAULT_FORMAL_STUDY || "formal_1";

let cachedConfig = null;

async function streamToString(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf-8");
}

async function getStudyConfig() {
  if (cachedConfig) return cachedConfig;
  const res = await s3.send(
    new GetObjectCommand({
      Bucket: CONFIG_BUCKET,
      Key: CONFIG_KEY
    })
  );
  const text = await streamToString(res.Body);
  cachedConfig = JSON.parse(text);
  return cachedConfig;
}

function normalizeLikert(raw, min = -3, max = 3) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  if (n < min || n > max) return null;
  return n;
}

function stringList(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((v) => String(v || "").trim())
    .filter((v) => v.length > 0);
}

function normalizeAiResponse(raw) {
  if (!raw || !raw.det_id) return null;

  const threat = normalizeLikert(raw.privacy_threat_score);
  const share = normalizeLikert(raw.share_willingness_score);
  const comfort = normalizeLikert(raw.ai_memory_comfort_score);
  const trust = normalizeLikert(raw.trust_ai_score);

  if (threat == null || share == null || comfort == null || trust == null) {
    return null;
  }

  const out = {
    det_id: { S: String(raw.det_id) },
    detected_visual: { S: String(raw.detected_visual || "") },
    privacy_threat_score: { N: `${threat}` },
    share_willingness_score: { N: `${share}` },
    ai_memory_comfort_score: { N: `${comfort}` },
    trust_ai_score: { N: `${trust}` }
  };

  if (raw.time_sec != null && Number.isFinite(Number(raw.time_sec))) {
    out.time_sec = { N: `${Number(raw.time_sec)}` };
  }

  const infoTypes = stringList(raw.information_types);
  if (infoTypes.length > 0) {
    out.information_types = { L: infoTypes.map((t) => ({ S: t })) };
  }

  if (raw.severity != null && Number.isFinite(Number(raw.severity))) {
    out.severity = { N: `${Number(raw.severity)}` };
  }
  if (raw.confidence) {
    out.confidence = { S: String(raw.confidence) };
  }
  if (raw.notes) {
    const note = String(raw.notes || "").trim();
    if (note.length > 0) out.notes = { S: note };
  }

  return { M: out };
}

function normalizeFinding(raw) {
  if (!raw) return null;
  const findingId = raw.finding_id || raw.id;
  if (!findingId) return null;

  const categories = stringList(raw.categories);
  if (categories.length === 0) return null;

  const threat = normalizeLikert(raw.privacy_threat_score);
  const share = normalizeLikert(raw.share_willingness_score);
  const comfort = normalizeLikert(raw.ai_memory_comfort_score);
  if (threat == null || share == null || comfort == null) return null;

  const desc = String(raw.description || "").trim();
  const allowEmptyDesc = categories.includes("none");
  if (!allowEmptyDesc && desc.length === 0) return null;

  const out = {
    finding_id: { S: String(findingId) },
    categories: { L: categories.map((c) => ({ S: c })) },
    privacy_threat_score: { N: `${threat}` },
    share_willingness_score: { N: `${share}` },
    ai_memory_comfort_score: { N: `${comfort}` }
  };

  if (raw.time_sec != null && Number.isFinite(Number(raw.time_sec))) {
    out.time_sec = { N: `${Number(raw.time_sec)}` };
  }

  if (desc.length > 0) {
    out.description = { S: desc };
  }

  const other = String(raw.other_text || "").trim();
  if (other.length > 0) {
    out.other_text = { S: other };
  }

  return { M: out };
}

function normalizeCrossResponse(raw, idx) {
  if (!raw) return null;
  const threatId = raw.threat_id || raw.id || `cross_${idx + 1}`;
  if (!threatId) return null;

  const threat = normalizeLikert(raw.cross_privacy_threat_score);
  const moreSevere = normalizeLikert(raw.cross_more_severe_score);
  const comfort = normalizeLikert(raw.cross_ai_memory_comfort_score);
  if (threat == null || moreSevere == null || comfort == null) return null;

  const out = {
    threat_id: { S: String(threatId) },
    cross_privacy_threat_score: { N: `${threat}` },
    cross_more_severe_score: { N: `${moreSevere}` },
    cross_ai_memory_comfort_score: { N: `${comfort}` }
  };

  if (raw.title) out.title = { S: String(raw.title) };
  const clips = stringList(raw.clips_involved);
  if (clips.length > 0) {
    out.clips_involved = { L: clips.map((c) => ({ S: c })) };
  }
  const infoTypes = stringList(raw.information_types);
  if (infoTypes.length > 0) out.information_types = { L: infoTypes.map((t) => ({ S: t })) };
  if (raw.severity_overall != null && Number.isFinite(Number(raw.severity_overall))) {
    out.severity_overall = { N: `${Number(raw.severity_overall)}` };
  }
  if (raw.confidence) out.confidence = { S: String(raw.confidence) };

  return { M: out };
}

export const handler = async (event) => {
  try {
    const cfg = await getStudyConfig();
    const body = event.body ? JSON.parse(event.body) : {};
    const participantId = (body.participantId || "").trim();
    const requestedStudy = (body.study || "").trim().toLowerCase();
    const studyLabel = requestedStudy === "pilot" ? "pilot" : DEFAULT_FORMAL_STUDY;
    const STUDY_ID = `${cfg.studyId}:${studyLabel}`;
    const storyId = body.storyId || null;
    const mode = body.mode || null;
    const clipIndex = Number(body.clipIndex);
    const clipId = body.clipId ? String(body.clipId) : null;
    const aiResponsesRaw = Array.isArray(body.aiResponses) ? body.aiResponses : [];
    const participantFindingsRaw = Array.isArray(body.participantFindings) ? body.participantFindings : [];
    const videoWatched = Boolean(body.videoWatched);
    const crossClipRaw = Array.isArray(body.crossClipResponses) ? body.crossClipResponses : [];

    if (!participantId) {
      return respond(400, { error: "participantId is required" });
    }
    if (!storyId) {
      return respond(400, { error: "storyId is required" });
    }
    if (!Number.isInteger(clipIndex) || clipIndex < 1) {
      return respond(400, { error: "clipIndex must be a positive integer (1-based)" });
    }

    const aiResponses = aiResponsesRaw.map((r) => normalizeAiResponse(r)).filter(Boolean);
    const participantFindings = participantFindingsRaw.map((r) => normalizeFinding(r)).filter(Boolean);
    const crossClipResponses = crossClipRaw.map((r, idx) => normalizeCrossResponse(r, idx)).filter(Boolean);

    if (aiResponses.length === 0 && participantFindings.length === 0 && crossClipResponses.length === 0) {
      return respond(400, { error: "At least one response is required to store clip annotation" });
    }

    const now = new Date().toISOString();
    const item = {
      pk: { S: "soups26_vlm_assignment_participant" },
      sk: { S: `${STUDY_ID}#participant_${participantId}#story_${storyId}#clip_${clipIndex}` },
      item_type: { S: "clip_annotation" },
      study_id: { S: STUDY_ID },
      study_label: { S: studyLabel },
      story_id: { S: String(storyId) },
      participant_id: { S: participantId },
      clip_index: { N: `${clipIndex}` },
      created_at: { S: now },
      updated_at: { S: now },
      video_watched: { BOOL: videoWatched }
    };

    if (clipId) item.clip_id = { S: clipId };
    if (mode) item.mode = { S: String(mode) };
    if (aiResponses.length > 0) item.ai_responses = { L: aiResponses };
    if (participantFindings.length > 0) item.participant_findings = { L: participantFindings };
    if (crossClipResponses.length > 0) item.cross_clip_responses = { L: crossClipResponses };

    await ddb.send(
      new PutItemCommand({
        TableName: TABLE,
        Item: item
      })
    );

    return respond(200, {
      participantId,
      studyId: STUDY_ID,
      study_label: studyLabel,
      storyId,
      clipIndex,
      clipId,
      savedAiResponses: aiResponses.length,
      savedParticipantFindings: participantFindings.length,
      videoWatched
    });
  } catch (err) {
    console.error("clip-annotation lambda error:", err);
    return respond(500, { error: err.message || "Internal server error" });
  }
};

function respond(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    },
    body: JSON.stringify(body)
  };
}
