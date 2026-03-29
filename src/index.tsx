import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";

import { App } from "./app";
import { runDoctor } from "./doctor";

const command = process.argv[2];

if (command === "doctor" || command === "--doctor") {
  process.exit(runDoctor());
}

if (command === "--help" || command === "-h") {
  console.log(`aimux\n\nUsage:\n  bun run src/index.tsx\n  bun run src/index.tsx doctor\n`);
  process.exit(0);
}

const renderer = await createCliRenderer({
  exitOnCtrlC: false,
  useAlternateScreen: true,
  useConsole: false,
  autoFocus: true,
  useMouse: true,
});

createRoot(renderer).render(<App />);
