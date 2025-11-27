import {
  DynamoDBClient,
  GetItemCommand,
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

export const handler = async (event) => {
  try {
    const cfg = await getStudyConfig();
    const STUDY_ID = cfg.studyId;
    const STORY_IDS = cfg.stories.map((s) => s.storyId);
    const MODES = cfg.modes || ["human", "vlm"];

    const body = event.body ? JSON.parse(event.body) : {};
    const participantId = body.participantId;

    if (!participantId) {
      return respond(400, { error: "participantId is required" });
    }

    const participantKey = {
      pk: { S: "soups26_vlm_assignment_participant" },
      sk: { S: `${STUDY_ID}#participant_${participantId}` }
    };

    // 1) existing assignment?
    const existing = await ddb.send(
      new GetItemCommand({
        TableName: TABLE,
        Key: participantKey
      })
    );

    if (existing.Item) {
      return respond(200, {
        participantId,
        studyId: STUDY_ID,
        storyId: existing.Item.story_id.S,
        mode: existing.Item.mode.S,
        finished: existing.Item.finished?.BOOL || false,
        reused: true
      });
    }

    // 2) allocate story+mode
    for (const storyId of STORY_IDS) {
      for (const mode of MODES) {
        const storyKey = {
          pk: { S: "soups26_vlm_assignment_story" },
          sk: { S: `${STUDY_ID}#${storyId}#${mode}` }
        };

        try {
          await ddb.send(
            new UpdateItemCommand({
              TableName: TABLE,
              Key: storyKey,
              UpdateExpression: "SET assigned_count = assigned_count + :inc",
              ConditionExpression: "assigned_count < max_assignments",
              ExpressionAttributeValues: {
                ":inc": { N: "1" }
              }
            })
          );

          await ddb.send(
            new PutItemCommand({
              TableName: TABLE,
              Item: {
                pk: { S: "soups26_vlm_assignment_participant" },
                sk: { S: `${STUDY_ID}#participant_${participantId}` },
                item_type: { S: "participant_assignment" },
                study_id: { S: STUDY_ID },
                participant_id: { S: participantId },
                story_id: { S: storyId },
                mode: { S: mode },
                finished: { BOOL: false },
                created_at: { S: new Date().toISOString() }
              },
              ConditionExpression: "attribute_not_exists(sk)"
            })
          );

          return respond(200, {
            participantId,
            studyId: STUDY_ID,
            storyId,
            mode,
            finished: false,
            reused: false
          });
        } catch (err) {
          if (err.name === "ConditionalCheckFailedException") continue;
          console.error("assign: DynamoDB error", err);
          continue;
        }
      }
    }

    return respond(409, { error: "No available tasks for this study" });
  } catch (err) {
    console.error("assign lambda error:", err);
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
