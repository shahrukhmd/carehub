import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const UPLOAD_ROOT = path.resolve(process.cwd(), "uploads");
const MAX_BYTES = 10 * 1024 * 1024;

const ALLOWED: Record<string, string> = {
  "application/pdf": ".pdf",
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "application/msword": ".doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
};

export function getUploadedFile(formData: FormData, key: string) {
  const value = formData.get(key);
  if (!(value instanceof File) || value.size === 0) return null;
  return value;
}

export async function saveUpload(file: File, practiceId: string) {
  const ext = ALLOWED[file.type];
  if (!ext) throw new Error("Only PDF, PNG, JPG, DOC or DOCX files can be uploaded");
  if (file.size > MAX_BYTES) throw new Error("Files must be 10 MB or smaller");

  const dir = path.join(UPLOAD_ROOT, practiceId);
  await mkdir(dir, { recursive: true });
  const storedName = `${randomUUID()}${ext}`;
  await writeFile(path.join(dir, storedName), Buffer.from(await file.arrayBuffer()));

  return {
    filePath: path.posix.join(practiceId, storedName),
    fileName: file.name.slice(0, 200),
    mimeType: file.type,
  };
}

export async function readUpload(relativePath: string) {
  const full = path.resolve(UPLOAD_ROOT, relativePath);
  if (!full.startsWith(UPLOAD_ROOT + path.sep)) throw new Error("Invalid file path");
  return readFile(full);
}
