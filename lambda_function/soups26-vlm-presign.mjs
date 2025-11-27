import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const s3 = new S3Client({});

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
    const bucket = cfg.bucketName;
    const storiesPrefix = cfg.storiesPrefix || "stories/";
    const participantsPrefix = cfg.participantsPrefix || "participants/";

    const body = event.body ? JSON.parse(event.body) : {};
    const operation = body.operation; // "get" | "put"
    const key = body.key;
    const contentType = body.contentType || "application/json";

    if (!operation || !key) {
      return respond(400, { error: "operation and key are required" });
    }

    if (!["get", "put"].includes(operation)) {
      return respond(400, { error: "operation must be 'get' or 'put'" });
    }

    // simple safety checks
    if (operation === "get") {
      if (!key.startsWith(storiesPrefix) && !key.startsWith(participantsPrefix)) {
        return respond(403, { error: "GET only allowed for stories/ or participants/ keys" });
      }
    } else {
      if (!key.startsWith(participantsPrefix)) {
        return respond(403, { error: "PUT only allowed under participants/ prefix" });
      }
    }

    let command;
    if (operation === "get") {
      command = new GetObjectCommand({ Bucket: bucket, Key: key });
    } else {
      command = new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        ContentType: contentType
      });
    }

    const url = await getSignedUrl(s3, command, { expiresIn: 3600 });

    return respond(200, { url });
  } catch (err) {
    console.error("presign lambda error:", err);
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
