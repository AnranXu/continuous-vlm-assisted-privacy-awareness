import {
  DynamoDBClient,
  GetItemCommand
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

    const participantKey = {
      pk: { S: "soups26_vlm_assignment_participant" },
      sk: { S: `${STUDY_ID}#participant_${participantId}` }
    };

    const prestudyKey = {
      pk: { S: "soups26_vlm_assignment_participant" },
      sk: { S: `${STUDY_ID}#participant_${participantId}#prestudy` }
    };

    const poststudyKey = {
      pk: { S: "soups26_vlm_assignment_participant" },
      sk: { S: `${STUDY_ID}#participant_${participantId}#poststudy` }
    };

    const [participantRes, prestudyRes, poststudyRes] = await Promise.all([
      ddb.send(new GetItemCommand({ TableName: TABLE, Key: participantKey })),
      ddb.send(new GetItemCommand({ TableName: TABLE, Key: prestudyKey })),
      ddb.send(new GetItemCommand({ TableName: TABLE, Key: poststudyKey }))
    ]);

    const pItem = participantRes.Item || {};
    const stage = pItem.stage?.N != null ? Number(pItem.stage.N) : 0;
    const finished = pItem.finished?.BOOL || false;
    const storyId = pItem.story_id?.S || null;
    const mode = pItem.mode?.S || null;

    return respond(200, {
      participantId,
      studyId: STUDY_ID,
      study_label: studyLabel,
      stage,
      finished,
      storyId,
      mode,
      prestudyExists: Boolean(prestudyRes.Item),
      poststudyExists: Boolean(poststudyRes.Item),
      createdAt: pItem.created_at?.S || null,
      updatedAt: pItem.updated_at?.S || null
    });
  } catch (err) {
    console.error("status lambda error:", err);
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
