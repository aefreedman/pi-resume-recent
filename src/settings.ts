import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { DEFAULT_MAX_AGE, parseMaxAge } from "./activity.ts";

export interface Settings { maxAge: string | null }

export async function readSettings(path: string): Promise<Settings> {
  let content: string;
  try {
    content = await readFile(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return { maxAge: DEFAULT_MAX_AGE };
    }
    throw error;
  }
  const data: unknown = JSON.parse(content);
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new Error(`${path}: expected a JSON object with maxAge.`);
  }
  if (Object.keys(data).some((key) => key !== "maxAge")) {
    throw new Error(`${path}: the only supported setting is maxAge.`);
  }
  const value = "maxAge" in data ? data.maxAge : DEFAULT_MAX_AGE;
  const duration = parseMaxAge(value);
  return { maxAge: duration === null ? null : String(value).trim() };
}

export async function writeSettings(path: string, maxAge: string | null): Promise<void> {
  const duration = parseMaxAge(maxAge);
  const settings: Settings = { maxAge: duration === null ? null : maxAge!.trim() };
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(settings, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}
