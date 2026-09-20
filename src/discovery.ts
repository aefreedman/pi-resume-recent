import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import type { SessionInfo } from "@earendil-works/pi-coding-agent";

export interface ScanOptions {
  directory: string;
  projectDirectories?: boolean;
  cwd?: string;
  cutoff: number | null;
  signal?: AbortSignal;
}
export type Progress = (loaded: number, total: number) => void;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseLine(line: string): Record<string, unknown> | null {
  if (!line.trim()) return null;
  try {
    const value: unknown = JSON.parse(line);
    return isRecord(value) ? value : null;
  } catch (error) {
    // Pi discovery skips malformed JSONL lines, including incomplete trailing writes.
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

function textContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.flatMap((block: unknown) =>
    isRecord(block) && block.type === "text" && typeof block.text === "string" ? [block.text] : [],
  ).join(" ");
}

/** Build the native picker's search/metadata shape only for shortlisted files. */
export async function readSessionInfo(path: string, mtime: Date, signal?: AbortSignal): Promise<SessionInfo | null> {
  const input = createReadStream(path, { encoding: "utf8", signal });
  const lines = createInterface({ input, crlfDelay: Infinity });
  let header: Record<string, unknown> | null = null;
  let name: string | undefined;
  let messageCount = 0;
  let firstMessage = "";
  let lastActivity: number | undefined;
  const messages: string[] = [];
  try {
    for await (const line of lines) {
      signal?.throwIfAborted();
      const entry = parseLine(line);
      if (!entry) continue;
      if (!header) {
        if (entry.type !== "session" || typeof entry.id !== "string") return null;
        header = entry;
        continue;
      }
      if (entry.type === "session_info") {
        name = typeof entry.name === "string" ? entry.name.trim() || undefined : undefined;
      }
      if (entry.type !== "message") continue;
      messageCount++;
      const message = entry.message;
      if (!isRecord(message) || !("content" in message)) continue;
      if (message.role !== "user" && message.role !== "assistant") continue;
      const timestamp = typeof message.timestamp === "number"
        ? message.timestamp
        : typeof entry.timestamp === "string" ? Date.parse(entry.timestamp) : NaN;
      if (Number.isFinite(timestamp)) lastActivity = Math.max(lastActivity ?? 0, timestamp);
      const text = textContent(message.content);
      if (!text) continue;
      messages.push(text);
      if (!firstMessage && message.role === "user") firstMessage = text;
    }
  } finally {
    lines.close();
    input.destroy();
  }
  if (!header || typeof header.id !== "string") return null;
  const created = new Date(typeof header.timestamp === "string" ? header.timestamp : NaN);
  const modified = lastActivity !== undefined && lastActivity > 0
    ? new Date(lastActivity)
    : Number.isFinite(created.getTime()) ? created : mtime;
  return {
    path,
    id: header.id,
    cwd: typeof header.cwd === "string" ? header.cwd : "",
    parentSessionPath: typeof header.parentSession === "string" ? header.parentSession : undefined,
    name,
    created,
    modified,
    messageCount,
    firstMessage: firstMessage || "(no messages)",
    allMessagesText: messages.join(" "),
  };
}

function missingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

async function sessionFiles(directory: string): Promise<string[]> {
  try {
    return (await readdir(directory)).filter((name) => name.endsWith(".jsonl")).sort((a, b) => b.localeCompare(a)).map((name) => join(directory, name));
  } catch (error) {
    if (missingFile(error)) return [];
    throw error;
  }
}

async function discoverFiles(options: ScanOptions): Promise<string[]> {
  if (!options.projectDirectories) return sessionFiles(options.directory);
  let directories;
  try {
    directories = await readdir(options.directory, { withFileTypes: true });
  } catch (error) {
    if (missingFile(error)) return [];
    throw error;
  }
  const files: string[] = [];
  for (const entry of directories) {
    options.signal?.throwIfAborted();
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    try {
      files.push(...await sessionFiles(join(options.directory, entry.name)));
    } catch (error) {
      // A symlink in the sessions root may point to a file rather than a project directory.
      if (entry.isSymbolicLink() && error instanceof Error && "code" in error && error.code === "ENOTDIR") continue;
      throw error;
    }
  }
  return files;
}

/** Enumerate/stat old logs, but never open their contents. Limit concurrent file work. */
export async function scanSessions(
  options: ScanOptions,
  onProgress?: Progress,
  readInfo: typeof readSessionInfo = readSessionInfo,
): Promise<SessionInfo[]> {
  options.signal?.throwIfAborted();
  const files = await discoverFiles(options);
  const results: (SessionInfo | null)[] = new Array(files.length).fill(null);
  let next = 0;
  let loaded = 0;
  // Some filesystems round mtimes to two seconds. Keep a small conservative margin.
  const mtimeCutoff = options.cutoff === null ? null : options.cutoff - 2_000;
  const worker = async () => {
    while (next < files.length) {
      options.signal?.throwIfAborted();
      const index = next++;
      const path = files[index];
      try {
        const metadata = await stat(path);
        if (!metadata.isFile()) continue;
        if (mtimeCutoff !== null && metadata.mtimeMs < mtimeCutoff) continue;
        options.signal?.throwIfAborted();
        const info = await readInfo(path, metadata.mtime, options.signal);
        if (!info) continue;
        if (options.cutoff !== null && info.modified.getTime() < options.cutoff) continue;
        if (options.cwd !== undefined && (!info.cwd || resolve(info.cwd) !== resolve(options.cwd))) continue;
        results[index] = info;
      } catch (error) {
        // Concurrent deletion is expected; permission and I/O failures must stay visible.
        if (!missingFile(error)) throw error;
      } finally {
        onProgress?.(++loaded, files.length);
      }
    }
  };
  // Await every worker even on failure so no file operations outlive this scan.
  const outcomes = await Promise.allSettled(Array.from({ length: Math.min(8, files.length) }, worker));
  for (const outcome of outcomes) if (outcome.status === "rejected") throw outcome.reason;
  options.signal?.throwIfAborted();
  return results.filter((info): info is SessionInfo => info !== null)
    .sort((a, b) => b.modified.getTime() - a.modified.getTime());
}
