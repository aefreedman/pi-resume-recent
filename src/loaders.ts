import { join, resolve } from "node:path";
import { getAgentDir, type SessionInfo } from "@earendil-works/pi-coding-agent";
import { scanSessions, type Progress } from "./discovery.ts";

export type SessionsLoader = (onProgress?: Progress) => Promise<SessionInfo[]>;

function defaultDirectory(cwd: string, agentDir: string): string {
  const encoded = `--${resolve(cwd).replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
  return join(resolve(agentDir), "sessions", encoded);
}

// ReadonlySessionManager does not expose usesDefaultSessionDir(). Mirror Pi 0.86.1's
// directory encoding without creating a directory or opening another session.
export function usesDefaultDirectory(cwd: string, sessionDir: string, agentDir: string): boolean {
  return !sessionDir || resolve(sessionDir) === defaultDirectory(cwd, agentDir);
}

export function createLoaders(
  cwd: string,
  sessionDir: string,
  cutoff: number | null,
  options: { agentDir?: string; scan?: typeof scanSessions; signal?: AbortSignal } = {},
): { current: SessionsLoader; all: SessionsLoader } {
  const agentDir = options.agentDir ?? getAgentDir();
  const scan = options.scan ?? scanSessions;
  const isDefault = usesDefaultDirectory(cwd, sessionDir, agentDir);
  const directory = sessionDir || defaultDirectory(cwd, agentDir);
  return {
    current: (progress) => scan({
      directory,
      cutoff,
      cwd: isDefault ? undefined : cwd,
      signal: options.signal,
    }, progress),
    all: (progress) => scan({
      directory: isDefault ? join(agentDir, "sessions") : directory,
      projectDirectories: isDefault,
      cutoff,
      signal: options.signal,
    }, progress),
  };
}
