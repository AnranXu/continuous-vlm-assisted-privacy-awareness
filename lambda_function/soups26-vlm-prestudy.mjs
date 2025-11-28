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
  const question = raw.question || "";
  const scoreNum = Number(raw.score);
  if (!Number.isFinite(scoreNum) || scoreNum < -3 || scoreNum > 3) return null;

  return {
    M: {
      question_id: { S: String(questionId) },
      question: { S: String(question) },
      score: { N: `${scoreNum}` },
      index: { N: `${Number(raw.index || idx + 1)}` }
    }
  };
}

export const handler = async (event) => {
  try {
    const cfg = await getStudyConfig();
    const STUDY_ID = cfg.studyId;

    const body = event.body ? JSON.parse(event.body) : {};
    const participantId = (body.participantId || "").trim();
    const answers = Array.isArray(body.answers) ? body.answers : [];
    const storyId = body.storyId || null;
    const mode = body.mode || null;

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
      sk: { S: `${STUDY_ID}#participant_${participantId}#prestudy` },
      item_type: { S: "prestudy_result" },
      study_id: { S: STUDY_ID },
      participant_id: { S: participantId },
      created_at: { S: now },
      updated_at: { S: now },
      answers: { L: normalizedAnswers }
    };

    if (storyId) item.story_id = { S: String(storyId) };
    if (mode) item.mode = { S: String(mode) };

    await ddb.send(
      new PutItemCommand({
        TableName: TABLE,
        Item: item
      })
    );

    // mark stage >= 1 on participant record
    const participantKey = {
      pk: { S: "soups26_vlm_assignment_participant" },
      sk: { S: `${STUDY_ID}#participant_${participantId}` }
    };
    try {
      await ddb.send(
        new UpdateItemCommand({
          TableName: TABLE,
          Key: participantKey,
          UpdateExpression: "SET stage = :stage, updated_at = :ts",
          ConditionExpression: "attribute_not_exists(stage) OR stage < :stage",
          ExpressionAttributeValues: {
            ":stage": { N: "1" },
            ":ts": { S: now }
          }
        })
      );
      console.info("Stage updated to 1 (prestudy) for", participantId);
    } catch (err) {
      if (err.name !== "ConditionalCheckFailedException") {
        console.warn("prestudy: stage update failed", err);
      }
    }

    return respond(200, {
      participantId,
      studyId: STUDY_ID,
      stored: true,
      answerCount: normalizedAnswers.length,
      stage: 1
    });
  } catch (err) {
    console.error("prestudy lambda error:", err);
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
