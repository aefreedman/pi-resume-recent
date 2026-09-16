import { join, resolve } from "node:path";
import { getAgentDir, SessionManager, type SessionInfo } from "@earendil-works/pi-coding-agent";
import { filterByActivity } from "./activity.ts";

type Progress = (loaded: number, total: number) => void;
export type SessionsLoader = (onProgress?: Progress) => Promise<SessionInfo[]>;

// ReadonlySessionManager does not expose usesDefaultSessionDir(). Mirror Pi 0.85.1's
// directory encoding without creating a directory or opening another session.
export function usesDefaultDirectory(cwd: string, sessionDir: string, agentDir: string): boolean {
  if (!sessionDir) return true;
  const encoded = `--${resolve(cwd).replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
  return resolve(sessionDir) === join(resolve(agentDir), "sessions", encoded);
}

export function createLoaders(
  cwd: string,
  sessionDir: string,
  cutoff: number | null,
  agentDir = getAgentDir(),
  manager: Pick<typeof SessionManager, "list" | "listAll"> = SessionManager,
): { current: SessionsLoader; all: SessionsLoader } {
  const defaultDirectory = usesDefaultDirectory(cwd, sessionDir, agentDir);
  return {
    current: async (progress) => filterByActivity(await manager.list(cwd, sessionDir || undefined, progress), cutoff),
    all: async (progress) => filterByActivity(
      await (defaultDirectory ? manager.listAll(progress) : manager.listAll(sessionDir, progress)),
      cutoff,
    ),
  };
}
