import {
  DynamoDBClient,
  PutItemCommand,
  UpdateItemCommand
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

function normalizeAnswer(raw, idx) {
  if (!raw) return null;
  const questionId = raw.id || `q${idx + 1}`;
  const scoreNum = Number(raw.score);
  if (!Number.isFinite(scoreNum) || scoreNum < -3 || scoreNum > 3) return null;

  return {
    M: {
      question_id: { S: String(questionId) },
      question: { S: String(raw.question || "") },
      title: { S: String(raw.title || "") },
      score: { N: `${scoreNum}` },
      index: { N: `${Number(raw.index || idx + 1)}` }
    }
  };
}

export const handler = async (event) => {
  try {
    const cfg = await getStudyConfig();
    const body = event.body ? JSON.parse(event.body) : {};
    const participantId = (body.participantId || "").trim();
    const requestedStudy = (body.study || "").trim().toLowerCase();
    const studyLabel = requestedStudy === "pilot" ? "pilot" : DEFAULT_FORMAL_STUDY;
    const STUDY_ID = `${cfg.studyId}:${studyLabel}`;
    const answers = Array.isArray(body.answers) ? body.answers : [];
    const storyId = body.storyId || null;
    const mode = body.mode || null;
    const freeText = body.freeText || "";

    if (!participantId) {
      return respond(400, { error: "participantId is required" });
    }
    if (!answers.length) {
      return respond(400, { error: "answers array is required" });
    }

    const normalizedAnswers = answers
      .map((ans, idx) => normalizeAnswer(ans, idx))
      .filter(Boolean);

    if (!normalizedAnswers.length) {
      return respond(400, { error: "No valid answers provided" });
    }

    const now = new Date().toISOString();
    const item = {
      pk: { S: "soups26_vlm_assignment_participant" },
      sk: { S: `${STUDY_ID}#participant_${participantId}#poststudy` },
      item_type: { S: "poststudy_result" },
      study_id: { S: STUDY_ID },
      study_label: { S: studyLabel },
      participant_id: { S: participantId },
      created_at: { S: now },
      updated_at: { S: now },
      answers: { L: normalizedAnswers },
      free_text: { S: String(freeText) }
    };

    if (storyId) item.story_id = { S: String(storyId) };
    if (mode) item.mode = { S: String(mode) };

    await ddb.send(
      new PutItemCommand({
        TableName: TABLE,
        Item: item
      })
    );

    // Stage 3 + finished flag on participant assignment
    const participantKey = {
      pk: { S: "soups26_vlm_assignment_participant" },
      sk: { S: `${STUDY_ID}#participant_${participantId}` }
    };
    await ddb.send(
      new UpdateItemCommand({
        TableName: TABLE,
        Key: participantKey,
        UpdateExpression: "SET stage = :stage, finished = :f, finished_at = :ts",
        ExpressionAttributeValues: {
          ":stage": { N: "3" },
          ":f": { BOOL: true },
          ":ts": { S: now }
        }
      })
    );

    console.info("Stage updated to 3 (poststudy/finished) for", participantId);
    return respond(200, {
      participantId,
      studyId: STUDY_ID,
      study_label: studyLabel,
      stored: true,
      answerCount: normalizedAnswers.length,
      stage: 3,
      finished: true
    });
  } catch (err) {
    console.error("poststudy lambda error:", err);
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
