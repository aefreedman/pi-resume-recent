import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { activityCutoff, filterByActivity, parseMaxAge } from "../src/activity.ts";
import { readSettings, writeSettings } from "../src/settings.ts";

test("arbitrary durations, fractional days, and all", () => {
  assert.equal(parseMaxAge("17d"), 17 * 86_400_000);
  assert.equal(parseMaxAge("36h"), 36 * 3_600_000);
  assert.equal(parseMaxAge("1.5d"), 36 * 3_600_000);
  assert.equal(parseMaxAge("90m"), 90 * 60_000);
  assert.equal(parseMaxAge("3w"), 21 * 86_400_000);
  assert.equal(parseMaxAge("all"), null);
  assert.equal(parseMaxAge(null), null);
});

test("invalid settings cannot silently broaden the list", () => {
  for (const value of ["", "0d", "-2d", "7", 7, false, {}, "7days", "Infinityd", "1d 2h", "7d trailing", "1e3d", "999999999999999999d", "0.000000001m"]) {
    assert.throws(() => parseMaxAge(value), String(value));
  }
});

test("inclusive rolling cutoff uses modified, preserves order, and ignores creation", () => {
  const now = Date.parse("2026-04-01T12:34:56Z");
  const cutoff = activityCutoff("7d", now)!;
  assert.equal(cutoff, Date.parse("2026-03-25T12:34:56Z"));
  const sessions = [
    { id: "old", modified: new Date(cutoff - 1), created: new Date(now) },
    { id: "boundary", modified: new Date(cutoff), created: new Date(0) },
    { id: "new", modified: new Date(now), created: new Date(0) },
  ];
  assert.deepEqual(filterByActivity(sessions, cutoff), [sessions[1], sessions[2]]);
  assert.equal(filterByActivity(sessions, null), sessions);
  assert.equal(sessions.length, 3);
});

test("saved settings round-trip, reread edits, and recover from malformed JSON by explicit replacement", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-resume-settings-"));
  const path = join(directory, "config.json");
  try {
    assert.deepEqual(await readSettings(path), { maxAge: "7d" });
    await writeSettings(path, "17d");
    assert.deepEqual(await readSettings(path), { maxAge: "17d" });
    await writeSettings(path, "all");
    assert.deepEqual(await readSettings(path), { maxAge: null });
    await writeFile(path, '{"maxAge":"36h"}');
    assert.deepEqual(await readSettings(path), { maxAge: "36h" });
    for (const content of ['{"maxAge":0}', '{"maxAge":"0d"}', '{"maxAg":"7d"}', '[]', 'null', '{broken']) {
      await writeFile(path, content);
      await assert.rejects(readSettings(path));
    }
    await assert.rejects(writeSettings(path, "bad"));
    assert.equal(await readFile(path, "utf8"), "{broken");
    await writeSettings(path, "2d");
    assert.deepEqual(await readSettings(path), { maxAge: "2d" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
