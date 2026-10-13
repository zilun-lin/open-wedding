import { z } from "zod";
import { requireFeature } from "../config/modules";
import type { WeddingConfig } from "../config/schema";
import type { AppEnv } from "../platform/context";
import { DomainError } from "./errors";
export const mediaSchema = z.object({
  name: z.string().min(1).max(180),
  type: z.enum([
    "image/jpeg",
    "image/png",
    "image/webp",
    "video/mp4",
    "video/webm",
  ]),
  size: z.number().int().positive(),
  caption: z.string().max(500).default(""),
});
export type MediaRow = {
  id: string;
  household_id: string;
  object_key: string;
  name: string;
  content_type: string;
  bytes: number;
  caption: string;
  status: string;
};
export function checkMediaOpen(config: WeddingConfig) {
  requireFeature(config, "memories");
  if (Date.now() < Date.parse(config.media.releaseAt))
    throw new DomainError(403, "memoriesNotOpen");
}
export async function startMedia(
  env: AppEnv,
  config: WeddingConfig,
  householdId: string,
  input: unknown,
) {
  checkMediaOpen(config);
  const data = mediaSchema.parse(input),
    id = crypto.randomUUID();
  if (data.size > config.media.maxFileMb * 1024 * 1024)
    throw new DomainError(413, "fileTooLarge");
  const result = await env.DB.prepare(
    "INSERT INTO media(id,household_id,object_key,name,content_type,bytes,caption,status,created_at) SELECT ?,?,?,?,?,?,?,'uploading',? WHERE (SELECT COUNT(*) FROM media WHERE household_id=?)<? AND COALESCE((SELECT SUM(bytes) FROM media WHERE household_id=?),0)+?<=?",
  )
    .bind(
      id,
      householdId,
      `memories/${id}`,
      data.name,
      data.type,
      data.size,
      data.caption,
      Date.now(),
      householdId,
      config.media.maxFilesPerHousehold,
      householdId,
      data.size,
      config.media.maxTotalMbPerHousehold * 1024 * 1024,
    )
    .run();
  if (!result.meta.changes) throw new DomainError(409, "uploadQuotaReached");
  return { id };
}
export function validSignature(type: string, bytes: Uint8Array) {
  const text = (start: number, end: number) =>
    new TextDecoder().decode(bytes.slice(start, end));
  return type === "image/jpeg"
    ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
    : type === "image/png"
      ? [137, 80, 78, 71, 13, 10, 26, 10].every((n, i) => bytes[i] === n)
      : type === "image/webp"
        ? text(0, 4) === "RIFF" && text(8, 12) === "WEBP"
        : type === "video/mp4"
          ? text(4, 8) === "ftyp"
          : type === "video/webm"
            ? [26, 69, 223, 163].every((n, i) => bytes[i] === n)
            : false;
}
export async function uploadMedia(
  request: Request,
  env: AppEnv,
  id: string,
  householdId: string,
) {
  const row = await env.DB.prepare(
    "UPDATE media SET status='receiving' WHERE id=? AND household_id=? AND status='uploading' RETURNING *",
  )
    .bind(id, householdId)
    .first<MediaRow>();
  if (!row) throw new DomainError(404, "notFound");
  try {
    if (
      !request.body ||
      Number(request.headers.get("content-length")) !== row.bytes ||
      request.headers.get("content-type") !== row.content_type
    )
      throw new DomainError(400, "invalidFile");
    const reader = request.body.getReader();
    const prefix: Uint8Array[] = [];
    let length = 0;
    while (length < 12) {
      const chunk = await reader.read();
      if (chunk.done) break;
      prefix.push(chunk.value);
      length += chunk.value.length;
    }
    const bytes = new Uint8Array(Math.min(length, 12));
    let offset = 0;
    for (const chunk of prefix) {
      const head = chunk.subarray(0, bytes.length - offset);
      bytes.set(head, offset);
      offset += head.length;
      if (offset === bytes.length) break;
    }
    if (!validSignature(row.content_type, bytes)) {
      await reader.cancel();
      throw new DomainError(400, "invalidFile");
    }
    const stream = new FixedLengthStream(row.bytes);
    const writer = stream.writable.getWriter();
    const pump = async () => {
      try {
        for (const chunk of prefix) await writer.write(chunk);
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          await writer.write(chunk.value);
        }
        await writer.close();
      } catch (error) {
        await writer.abort(error);
        throw error;
      }
    };
    await Promise.all([
      env.MEDIA.put(row.object_key, stream.readable, {
        httpMetadata: { contentType: row.content_type },
      }),
      pump(),
    ]);
    await env.DB.prepare(
      "UPDATE media SET status='pending' WHERE id=? AND status='receiving'",
    )
      .bind(id)
      .run();
    return { id };
  } catch (error) {
    await env.MEDIA.delete(row.object_key);
    await env.DB.prepare("DELETE FROM media WHERE id=?").bind(id).run();
    throw error;
  }
}
