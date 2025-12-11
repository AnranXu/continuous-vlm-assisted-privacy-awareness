import {
  DynamoDBClient,
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

export const handler = async (event) => {
  try {
    const cfg = await getStudyConfig();
    const body = event.body ? JSON.parse(event.body) : {};
    const participantId = (body.participantId || "").trim();
    const requestedStudy = (body.study || "").trim().toLowerCase();
    const studyLabel = requestedStudy === "pilot" ? "pilot" : DEFAULT_FORMAL_STUDY;
    const STUDY_ID = `${cfg.studyId}:${studyLabel}`;

    if (!participantId) {
      return respond(400, { error: "participantId is required" });
    }

    const sk = `${STUDY_ID}#participant_${participantId}`;

    await ddb.send(
      new UpdateItemCommand({
        TableName: TABLE,
        Key: {
          pk: { S: "soups26_vlm_assignment_participant" },
          sk: { S: sk }
        },
        UpdateExpression: "SET finished = :t, finished_at = :ts, stage = :stage",
        ExpressionAttributeValues: {
          ":t": { BOOL: true },
          ":ts": { S: new Date().toISOString() },
          ":stage": { N: "3" }
        }
      })
    );

    return respond(200, {
      participantId,
      studyId: STUDY_ID,
      study_label: studyLabel,
      updated: true
    });
  } catch (err) {
    console.error("mark-finished lambda error:", err);
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
