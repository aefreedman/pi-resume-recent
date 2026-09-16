import { join } from "node:path";
import {
  getAgentDir,
  SessionManager,
  SessionSelectorComponent,
  type ExtensionAPI,
  type ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { activityCutoff, parseMaxAge } from "./src/activity.ts";
import { createLoaders } from "./src/loaders.ts";
import { readSettings, writeSettings } from "./src/settings.ts";

export async function openRecentPicker(args: string, ctx: ExtensionCommandContext, pi: ExtensionAPI): Promise<void> {
  if (ctx.mode !== "tui") throw new Error("/resume-recent requires Pi's interactive terminal mode.");
  if (!ctx.isIdle()) {
    ctx.ui.notify("Wait for the current turn to finish before opening the session picker.", "warning");
    return;
  }
  const override = args.trim();
  const maxAge = override || (await readSettings(join(getAgentDir(), "pi-resume-recent.json"))).maxAge;
  const cutoff = activityCutoff(maxAge);
  const manager = ctx.sessionManager;
  const currentFile = manager.getSessionFile();
  const controller = new AbortController();
  const loaders = createLoaders(manager.getCwd(), manager.getSessionDir(), cutoff, { signal: controller.signal });
  const selected = await ctx.ui.custom<string | null>((tui, _theme, keybindings, done) => {
    let disposed = false;
    const requestRender = () => { if (!disposed) tui.requestRender(); };
    const picker = new SessionSelectorComponent(
      loaders.current,
      loaders.all,
      (path) => done(path),
      () => done(null),
      () => { done(null); ctx.shutdown(); },
      requestRender,
      {
        keybindings,
        showRenameHint: true,
        renameSession: async (path, name) => {
          const next = name?.trim();
          if (!next) return;
          try {
            // Keep the active manager in sync rather than appending through a second instance.
            if (path === currentFile) pi.setSessionName(next);
            else SessionManager.open(path).appendSessionInfo(next);
          } catch (error) {
            ctx.ui.notify(`Failed to rename session: ${error instanceof Error ? error.message : String(error)}`, "error");
          }
        },
      },
      currentFile,
    );
    return {
      get focused() { return picker.focused; },
      set focused(value: boolean) { picker.focused = value; },
      render: (width: number) => picker.render(width),
      invalidate: () => picker.invalidate(),
      handleInput: (data: string) => { picker.handleInput(data); requestRender(); },
      dispose: () => { disposed = true; controller.abort(); },
    };
  });
  if (selected) {
    const result = await ctx.switchSession(selected);
    if (result.cancelled) ctx.ui.notify("Session switch cancelled.", "info");
  }
}

export default function resumeRecent(pi: ExtensionAPI): void {
  pi.registerCommand("resume-recent", {
    description: "Resume with Pi's native picker, filtered by activity: [duration | all]",
    handler: (args, ctx) => openRecentPicker(args, ctx, pi),
  });
  pi.registerCommand("resume-recent-settings", {
    description: "Set the saved activity window: [duration | all]",
    handler: async (args, ctx) => {
      if (ctx.mode !== "tui") throw new Error("/resume-recent-settings requires Pi's interactive terminal mode.");
      const path = join(getAgentDir(), "pi-resume-recent.json");
      let value = args.trim();
      if (!value) {
        const current = await readSettings(path);
        const input = await ctx.ui.input(`Recent session window (current: ${current.maxAge ?? "all"})`, "Duration, e.g. 7d or 36h; all to disable");
        if (input === undefined) return;
        value = input.trim();
      }
      parseMaxAge(value);
      await writeSettings(path, value);
      ctx.ui.notify(`Recent session window saved: ${value}. Applies next time you open /resume-recent.`, "info");
    },
  });
}
