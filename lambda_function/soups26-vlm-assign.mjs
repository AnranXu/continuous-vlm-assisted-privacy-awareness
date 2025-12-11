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
const DEFAULT_FORMAL_STUDY = process.env.DEFAULT_FORMAL_STUDY || "formal_1";
const DEFAULT_MAX_ASSIGNMENTS = Number(process.env.DEFAULT_MAX_ASSIGNMENTS || "9999");

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
    const STORY_STUDY_KEY = studyLabel; // matches existing DynamoDB sk seed format <study>#story#mode
    const STORY_IDS = cfg.stories.map((s) => s.storyId);
    const MODES = cfg.modes || ["human", "vlm"];

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
      const existingStoryId = existing.Item.story_id?.S;
      const existingMode = existing.Item.mode?.S;
      if (existingStoryId && existingMode) {
        return respond(200, {
          participantId,
          studyId: STUDY_ID,
          study_label: studyLabel,
          storyId: existingStoryId,
          mode: existingMode,
          finished: existing.Item.finished?.BOOL || false,
          stage: existing.Item.stage?.N ? Number(existing.Item.stage.N) : 0,
          reused: true
        });
      } else {
        console.warn("assign: existing participant record missing fields, reallocating", existing.Item);
      }
    }

    let lastError = null;
    const missingStoryKeys = [];
    // 2) load all story+mode items (must exist) and pick best candidate
    const storyRecords = [];
    for (const storyId of STORY_IDS) {
      for (const mode of MODES) {
        const storyKey = {
          pk: { S: "soups26_vlm_assignment_story" },
          sk: { S: `${STORY_STUDY_KEY}#${storyId}#${mode}` }
        };
        const legacyStoryKey = {
          pk: { S: "soups26_vlm_assignment_story" },
          sk: { S: `${storyId}#${mode}` }
        };
        const altStoryKey = {
          pk: { S: "soups26_vlm_assignment_story" },
          sk: { S: `${STUDY_ID}#${storyId}#${mode}` }
        };

        try {
          let storyRes = await ddb.send(
            new GetItemCommand({
              TableName: TABLE,
              Key: storyKey
            })
          );
          let usedLegacyKey = false;
          let usedAltKey = false;
          if (!storyRes.Item) {
            storyRes = await ddb.send(
              new GetItemCommand({
                TableName: TABLE,
                Key: altStoryKey
              })
            );
            usedAltKey = Boolean(storyRes.Item);
          }
          if (!storyRes.Item) {
            // fallback to legacy key without study prefix
            storyRes = await ddb.send(
              new GetItemCommand({
                TableName: TABLE,
                Key: legacyStoryKey
              })
            );
            usedLegacyKey = Boolean(storyRes.Item);
          }

          if (!storyRes.Item) {
            missingStoryKeys.push(storyKey.sk.S);
            missingStoryKeys.push(altStoryKey.sk.S);
            missingStoryKeys.push(legacyStoryKey.sk.S);
            lastError = new Error(`Story assignment item missing for ${storyKey.sk.S}`);
            console.error("assign: story item missing", storyKey.sk.S, "alt tried", altStoryKey.sk.S, "legacy tried", legacyStoryKey.sk.S);
            continue;
          }
          const item = storyRes.Item;
          const ac = item.assigned_count;
          const ma = item.max_assignments;
          let assignedCount = 0;
          let maxAssignments = DEFAULT_MAX_ASSIGNMENTS;
          if (ac?.N) assignedCount = Number(ac.N);
          else if (ac?.S && !Number.isNaN(Number(ac.S))) assignedCount = Number(ac.S);
          if (ma?.N) maxAssignments = Number(ma.N);
          else if (ma?.S && !Number.isNaN(Number(ma.S))) maxAssignments = Number(ma.S);

          storyRecords.push({
            storyId,
            mode,
            storyKey: usedLegacyKey ? legacyStoryKey : usedAltKey ? altStoryKey : storyKey,
            assignedCount,
            maxAssignments
          });
        } catch (err) {
          lastError = err;
          console.error("assign: failed to read story item", storyKey.sk, err);
        }
      }
    }

    if (storyRecords.length === 0) {
      return respond(409, {
        error: "No story assignment items found",
        detail: {
          studyId: STUDY_ID,
          missing: missingStoryKeys
        }
      });
    }

    const sorted = storyRecords.slice().sort((a, b) => {
      if (a.assignedCount !== b.assignedCount) return a.assignedCount - b.assignedCount;
      if (a.storyId !== b.storyId) return a.storyId.localeCompare(b.storyId);
      return a.mode.localeCompare(b.mode);
    });

    const available = sorted.filter((r) => r.assignedCount < r.maxAssignments);
    const chosen = available.length > 0 ? available[0] : sorted[0];

    if (!chosen) {
      return respond(409, { error: "No available tasks for this study", studyId: STUDY_ID });
    }

    const newCount = chosen.assignedCount + 1;

    try {
      await ddb.send(
        new UpdateItemCommand({
          TableName: TABLE,
          Key: chosen.storyKey,
          ConditionExpression: "attribute_exists(pk)",
          UpdateExpression:
            "SET #ac = :newCount, " +
            "#max = if_not_exists(#max, :max), " +
            "#type = if_not_exists(#type, :storyType), " +
            "#sid = :sid, " +
            "#slabel = :slabel, " +
            "#storyId = :storyId, " +
            "#mode = :modeVal",
          ExpressionAttributeNames: {
            "#ac": "assigned_count",
            "#max": "max_assignments",
            "#type": "item_type",
            "#sid": "study_id",
            "#slabel": "study_label",
            "#storyId": "story_id",
            "#mode": "mode"
          },
          ExpressionAttributeValues: {
            ":newCount": { N: `${newCount}` },
            ":max": { N: `${chosen.maxAssignments}` },
            ":storyType": { S: "story_assignment" },
            ":sid": { S: STUDY_ID },
            ":slabel": { S: studyLabel },
            ":storyId": { S: chosen.storyId },
            ":modeVal": { S: chosen.mode }
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
            study_label: { S: studyLabel },
            participant_id: { S: participantId },
            story_id: { S: chosen.storyId },
            mode: { S: chosen.mode },
            finished: { BOOL: false },
            stage: { N: "0" },
            created_at: { S: new Date().toISOString() }
          },
          ConditionExpression: "attribute_not_exists(sk)"
        })
      );

      return respond(200, {
        participantId,
        studyId: STUDY_ID,
        study_label: studyLabel,
        storyId: chosen.storyId,
        mode: chosen.mode,
        finished: false,
        stage: 0,
        reused: false
      });
    } catch (err) {
      lastError = err;
      console.error("assign: DynamoDB error", err);
    }

    if (lastError && lastError.name !== "ConditionalCheckFailedException") {
      return respond(500, {
        error: "Assignment failed",
        code: lastError.name || "unknown",
        message: lastError.message || String(lastError),
        detail: typeof lastError === "object" ? JSON.stringify(lastError, null, 2) : String(lastError)
      });
    }

    return respond(409, { error: "No available tasks for this study", studyId: STUDY_ID });
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
