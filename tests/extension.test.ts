import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { discoverAndLoadExtensions } from "@earendil-works/pi-coding-agent";

test("Pi's extension loader registers only the pilot commands with no tools or hooks", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-resume-loader-"));
  try {
    const result = await discoverAndLoadExtensions([resolve("index.ts")], root, root);
    assert.deepEqual(result.errors, []);
    assert.equal(result.extensions.length, 1);
    const extension = result.extensions[0];
    assert.deepEqual([...extension.commands.keys()], ["resume-recent", "resume-recent-settings"]);
    assert.equal(extension.tools.size, 0);
    assert.equal(extension.handlers.size, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
