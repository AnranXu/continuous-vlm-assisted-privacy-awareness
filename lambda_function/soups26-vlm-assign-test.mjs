// index.mjs — soups26_vlm_assign_test (NO CORS HEADERS)

import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";

const s3 = new S3Client({ region: process.env.AWS_REGION });

// helper: stream -> string
async function streamToString(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

export const handler = async (event) => {
  try {
    const body = event.body ? JSON.parse(event.body) : {};

    const participantId = body.participantId || "TEST_USER";

    // storyIndex is 1-based; default 1
    const storyIndex = parseInt(body.storyIndex ?? 1, 10);
    const modeParam = (body.mode || "human").toString().toLowerCase();
    const mode = modeParam === "vlm" ? "vlm" : "human";

    if (!Number.isFinite(storyIndex) || storyIndex < 1) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Invalid storyIndex" }),
      };
    }

    const bucket = process.env.BUCKET_NAME;
    const studyConfigKey = process.env.STUDY_CONFIG_KEY || "study_config.json";

    // Load study_config.json from S3
    const obj = await s3.send(
      new GetObjectCommand({ Bucket: bucket, Key: studyConfigKey })
    );
    const text = await streamToString(obj.Body);
    const studyConfig = JSON.parse(text);

    const stories = studyConfig.stories || [];
    if (!stories.length) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: "No stories in study_config.json" }),
      };
    }

    if (storyIndex > stories.length) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: `storyIndex ${storyIndex} out of range (1..${stories.length})`,
        }),
      };
    }

    const storyId = stories[storyIndex - 1].storyId;

    const result = {
      participantId,
      studyId: studyConfig.studyId || process.env.STUDY_ID || "soups26_vlma_01",
      storyId,
      mode,          // "human" or "vlm" (your experimental condition)
      storyIndex,
      testMode: true,
      finished: false,
      reused: true,
    };

    return {
      statusCode: 200,
      body: JSON.stringify(result),
    };
  } catch (err) {
    console.error("assign-test error", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Internal error", detail: String(err) }),
    };
  }
};
