import { describe, expect, test } from "bun:test";

import { PtyManager } from "../../src/pty/pty-manager";

describe("PtyManager", () => {
  test("spawns a command through Bun.Terminal and renders output", async () => {
    const manager = new PtyManager();
    let latestBuffer = "";

    const exitCode = await new Promise<number>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Timed out waiting for PTY session"));
      }, 5_000);

      manager.on("render", (_tabId, buffer) => {
        latestBuffer = buffer;
      });

      manager.on("error", (_tabId, message) => {
        clearTimeout(timeout);
        reject(new Error(message));
      });

      manager.on("exit", (_tabId, code) => {
        clearTimeout(timeout);
        resolve(code);
      });

      manager.createSession({
        tabId: "tab-1",
        command: "pwd",
        cols: 80,
        rows: 24,
        cwd: process.cwd(),
      });
    });

    expect(exitCode).toBe(0);
    expect(latestBuffer).toContain(process.cwd());
    manager.disposeAll();
  });
});
