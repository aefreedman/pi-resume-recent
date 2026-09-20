import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test, { after } from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { scanSessions, readSessionInfo } from "../src/discovery.ts";
import { createLoaders } from "../src/loaders.ts";
import { filterByActivity } from "../src/activity.ts";

const root = await mkdtemp(join(tmpdir(), "pi-resume-discovery-"));
const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = join(root, "agent");
after(async () => {
  if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  await rm(root, { recursive: true, force: true });
});
const now = Date.parse("2026-04-01T12:00:00Z");
const cutoff = now - 3 * 86_400_000;
const old = now - 90 * 86_400_000;
const cwd = resolve("example-project");

async function makeSession(directory: string, id: string, timestamp: number, options: { cwd?: string; text?: string; mtime?: number } = {}): Promise<string> {
  await mkdir(directory, { recursive: true });
  const path = join(directory, `${id}.jsonl`);
  const entries = [
    { type: "session", version: 3, id, cwd: options.cwd ?? cwd, timestamp: new Date(old).toISOString() },
    { type: "message", id: "msg", parentId: null, timestamp: new Date(timestamp).toISOString(), message: { role: "user", content: options.text ?? id, timestamp } },
  ];
  await writeFile(path, entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
  await utimes(path, new Date(options.mtime ?? timestamp), new Date(options.mtime ?? timestamp));
  return path;
}

test("old log contents are never opened; reopening an old session is included", async (t) => {
  const directory = join(root, "history");
  for (let index = 0; index < 24; index++) {
    await makeSession(directory, `old-${index}`, old, { text: "x".repeat(512 * 1024) });
  }
  const recent = await makeSession(directory, "recently-reopened", now - 30 * 60_000);
  const opened: string[] = [];
  const progress: number[] = [];
  const started = performance.now();
  const actual = await scanSessions({ directory, cutoff }, (loaded) => progress.push(loaded), async (...args) => {
    opened.push(args[0]);
    return readSessionInfo(...args);
  });
  const filteredMs = performance.now() - started;
  const nativeStarted = performance.now();
  const expected = filterByActivity(await SessionManager.list(cwd, directory), cutoff);
  const nativeMs = performance.now() - nativeStarted;
  assert.deepEqual(actual, expected);
  assert.deepEqual(opened, [recent]);
  assert.equal(progress.at(-1), 25);
  t.diagnostic(`Synthetic 12 MiB archive: opened 1/25 logs; filtered scan ${filteredMs.toFixed(1)} ms, full native scan ${nativeMs.toFixed(1)} ms.`);
});

test("freshly touched old logs are excluded by actual activity; all bypasses backdated mtimes", async () => {
  const directory = join(root, "timestamps");
  await makeSession(directory, "touched-old", old, { mtime: now });
  const backdated = await makeSession(directory, "backdated", now, { mtime: old });
  const boundary = await makeSession(directory, "boundary", cutoff, { mtime: cutoff - 1_500 });
  const results = await scanSessions({ directory, cutoff });
  assert.deepEqual(results.map((session) => session.path), [boundary]);
  assert.ok((await scanSessions({ directory, cutoff: null })).some((session) => session.path === backdated));
});

test("custom storage filters cwd for Current Folder and preserves all projects for All", async () => {
  const directory = join(root, "custom");
  const current = await makeSession(directory, "current", now);
  const other = await makeSession(directory, "other", now, { cwd: resolve("other-project") });
  await makeSession(directory, "old", old);
  const loaders = createLoaders(cwd, directory, cutoff);
  assert.deepEqual((await loaders.current()).map((session) => session.path), [current]);
  assert.deepEqual(new Set((await loaders.all()).map((session) => session.path)), new Set([current, other]));
});

test("default All scans project directories, without descending into unrelated nested archives", async () => {
  const agentDir = join(root, "default-agent");
  const encoded = `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
  const directory = join(agentDir, "sessions", encoded);
  const current = await makeSession(directory, "current", now);
  const other = await makeSession(join(agentDir, "sessions", "--other--"), "other", now);
  await makeSession(join(directory, "nested"), "nested", now);
  await makeSession(directory, "old", old);
  const loaders = createLoaders(cwd, directory, cutoff, { agentDir });
  assert.deepEqual((await loaders.current()).map((session) => session.path), [current]);
  assert.deepEqual(new Set((await loaders.all()).map((session) => session.path)), new Set([current, other]));
});

test("metadata and search text match Pi across message roles, timestamp ordering, names, and malformed lines", async () => {
  const directory = join(root, "parity");
  await mkdir(directory, { recursive: true });
  const path = join(directory, "messages.jsonl");
  const entries = [
    { type: "session", version: 3, id: "parity", cwd, timestamp: new Date(old).toISOString(), parentSession: join(directory, "parent.jsonl") },
    { type: "session_info", name: "Initial" },
    { type: "message", timestamp: new Date(now - 3000).toISOString(), message: { role: "system", content: "transcript prompt patch", timestamp: now - 3000 } },
    { type: "usage", kind: "cache_warm", timestamp: new Date(now - 2500).toISOString(), usage: { input: 0, output: 0, cacheRead: 1, cacheWrite: 0, totalTokens: 1, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } },
    { type: "message", timestamp: new Date(now).toISOString(), message: { role: "user", content: [{ type: "text", text: "first" }, { type: "image", data: "ignored" }, { type: "text", text: "question" }] } },
    { type: "message", timestamp: new Date(now - 1000).toISOString(), message: { role: "assistant", timestamp: now - 2000, content: [{ type: "thinking", thinking: "ignored" }, { type: "text", text: "answer" }] } },
    { type: "message", message: { role: "toolResult", timestamp: now + 9000, content: "not searchable" } },
    { type: "message", message: { role: "custom", timestamp: now + 8000, content: "also not searchable" } },
    { type: "session_info", name: "   " },
  ];
  await writeFile(path, "\n{malformed\n" + entries.map((entry) => JSON.stringify(entry)).join("\n") + '\n{"incomplete":');
  const actual = await scanSessions({ directory, cutoff });
  assert.deepEqual(actual, await SessionManager.list(cwd, directory));
  assert.equal(actual[0].modified.getTime(), now);
  assert.equal(actual[0].allMessagesText, "first question answer");
  assert.equal(actual[0].name, undefined);
});

test("empty sessions use header time then mtime, matching Pi", async () => {
  const directory = join(root, "empty");
  await mkdir(directory, { recursive: true });
  for (const [id, timestamp] of [["header", new Date(now).toISOString()], ["mtime", "invalid"]]) {
    const path = join(directory, `${id}.jsonl`);
    await writeFile(path, JSON.stringify({ type: "session", version: 3, id, cwd, timestamp }) + "\n");
    await utimes(path, new Date(now), new Date(now));
  }
  const actual = await scanSessions({ directory, cutoff });
  const expected = await SessionManager.list(cwd, directory);
  // Node versions differ on deep equality for two Invalid Date objects.
  const normalize = (sessions: typeof actual) => sessions.map((session) => ({ ...session, created: session.created.getTime() }));
  assert.deepEqual(normalize(actual), normalize(expected));
  assert.ok(actual.every((session) => session.modified.getTime() === now));
});

test("cancellation stops a live read and prevents further discovery", async () => {
  const directory = join(root, "cancel");
  await makeSession(directory, "recent", now, { text: "x".repeat(1024 * 1024) });
  const controller = new AbortController();
  await assert.rejects(scanSessions({ directory, cutoff, signal: controller.signal }, undefined, async (...args) => {
    const reading = readSessionInfo(...args);
    controller.abort();
    return reading;
  }), { name: "AbortError" });
  await assert.rejects(scanSessions({ directory, cutoff, signal: controller.signal }), { name: "AbortError" });
});

test("missing directories and deletion races are tolerated, other I/O errors propagate", async () => {
  assert.deepEqual(await scanSessions({ directory: join(root, "missing"), cutoff }), []);
  const directory = join(root, "errors");
  await makeSession(directory, "recent", now);
  assert.deepEqual(await scanSessions({ directory, cutoff }, undefined, async () => {
    throw Object.assign(new Error("deleted"), { code: "ENOENT" });
  }), []);
  await assert.rejects(scanSessions({ directory, cutoff }, undefined, async () => {
    throw Object.assign(new Error("denied"), { code: "EACCES" });
  }), /denied/);
});
