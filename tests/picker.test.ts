import assert from "node:assert/strict";
import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test, { after } from "node:test";
import { initTheme, SessionManager, SessionSelectorComponent, type SessionInfo } from "@earendil-works/pi-coding-agent";
import { createLoaders, usesDefaultDirectory } from "../src/loaders.ts";

const now = Date.parse("2026-04-01T12:00:00Z");
const cutoff = now - 7 * 86_400_000;
function session(id: string, modified: number, extra: Partial<SessionInfo> = {}): SessionInfo {
  return { id, path: resolve(`${id}.jsonl`), cwd: process.cwd(), created: new Date(0), modified: new Date(modified), messageCount: 2, firstMessage: id, allMessagesText: id, ...extra };
}
const settle = () => new Promise<void>((done) => setImmediate(done));

const isolatedAgent = await mkdtemp(join(tmpdir(), "pi-resume-agent-"));
const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = isolatedAgent;
after(async () => {
  if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  await rm(isolatedAgent, { recursive: true, force: true });
});
initTheme("dark", false);

test("custom directory routing stays scoped and filters every refresh with one cutoff", async () => {
  let currentCalls = 0;
  const rows = [session("old", cutoff - 1), session("included", cutoff)];
  const directory = resolve("custom-sessions");
  const manager: Pick<typeof SessionManager, "list" | "listAll"> = {
    list: async (cwd, dir, progress) => {
      currentCalls++;
      assert.equal(cwd, process.cwd());
      assert.equal(dir, directory);
      progress?.(2, 2);
      return rows;
    },
    listAll: async (dir) => { assert.equal(dir, directory); return rows; },
  };
  const loaders = createLoaders(process.cwd(), directory, cutoff, resolve("agent"), manager);
  const progress: number[] = [];
  assert.deepEqual(await loaders.current((loaded) => progress.push(loaded)), [rows[1]]);
  assert.deepEqual(await loaders.all(), [rows[1]]);
  assert.deepEqual(await loaders.current(), [rows[1]]);
  assert.equal(currentCalls, 2);
  assert.deepEqual(progress, [2]);
});

test("default storage routes All through Pi's global listing", async () => {
  const agent = resolve("agent");
  const cwd = process.cwd();
  const encoded = `--${resolve(cwd).replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
  const directory = join(agent, "sessions", encoded);
  assert.equal(usesDefaultDirectory(cwd, directory, agent), true);
  assert.equal(usesDefaultDirectory(cwd, `${directory}-custom`, agent), false);
  const progress = () => {};
  const manager: Pick<typeof SessionManager, "list" | "listAll"> = {
    list: async () => [],
    listAll: async (received) => { assert.equal(received, progress); return []; },
  };
  await createLoaders(cwd, directory, cutoff, agent, manager).all(progress);
});

test("native picker renders identically for filtered input; scope, search, sorting, and cancellation work", async () => {
  const parent = session("old-parent", cutoff - 1);
  const child = session("recent-child", now, { name: "Recent child", parentSessionPath: parent.path });
  const other = session("other-project", now, { cwd: resolve("other") });
  const rows = [parent, child];
  const manager: Pick<typeof SessionManager, "list" | "listAll"> = {
    list: async () => rows,
    listAll: async () => [...rows, other],
  };
  const loaders = createLoaders(process.cwd(), resolve("custom"), cutoff, resolve("agent"), manager);
  let selected: string | undefined;
  let cancelled = false;
  const picker = new SessionSelectorComponent(loaders.current, loaders.all, (path) => { selected = path; }, () => { cancelled = true; }, () => {}, () => {});
  const reference = new SessionSelectorComponent(async () => [child], async () => [child, other], () => {}, () => {}, () => {}, () => {});
  await settle();
  for (const width of [40, 80, 120]) assert.deepEqual(picker.render(width), reference.render(width));
  assert.equal(picker.getSessionList().getSelectedSessionPath(), child.path);
  // The old parent is excluded even in threaded mode; its recent child remains selectable.
  assert.ok(!picker.render(120).join("\n").includes("old-parent"));
  picker.handleInput("\x13"); // Ctrl+S
  picker.handleInput("\t");
  await settle();
  picker.handleInput("other-project");
  assert.equal(picker.getSessionList().getSelectedSessionPath(), other.path);
  picker.handleInput("\r");
  assert.equal(selected, other.path);
  picker.handleInput("\x1b");
  assert.equal(cancelled, true);
});

test("Pi activity timestamps win over a fresh filesystem mtime and session rename", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-resume-sessions-"));
  const cwd = process.cwd();
  const make = async (id: string, timestamp: number) => {
    const path = join(directory, `${id}.jsonl`);
    const entries = [
      { type: "session", version: 3, id, cwd, timestamp: new Date(0).toISOString() },
      { type: "message", id: "msg", parentId: null, timestamp: new Date(timestamp).toISOString(), message: { role: "user", content: id, timestamp } },
      { type: "session_info", id: "rename", parentId: "msg", timestamp: new Date(now).toISOString(), name: id },
    ];
    await writeFile(path, entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
    await utimes(path, new Date(), new Date());
  };
  try {
    await make("00000000-0000-4000-8000-000000000001", cutoff - 1);
    await make("00000000-0000-4000-8000-000000000002", cutoff);
    const loaders = createLoaders(cwd, directory, cutoff);
    const sessions = await loaders.current();
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].modified.getTime(), cutoff);
    assert.equal((await loaders.all()).length, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("loader failures propagate instead of turning into an unfiltered result", async () => {
  const manager: Pick<typeof SessionManager, "list" | "listAll"> = {
    list: async () => { throw new Error("read failed"); },
    listAll: async () => { throw new Error("read failed"); },
  };
  const loaders = createLoaders(process.cwd(), resolve("custom"), cutoff, resolve("agent"), manager);
  await assert.rejects(loaders.current(), /read failed/);
  await assert.rejects(loaders.all(), /read failed/);
});
