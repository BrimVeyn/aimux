import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";

import { App } from "./app";

const renderer = await createCliRenderer({
  exitOnCtrlC: false,
  useAlternateScreen: true,
  useConsole: false,
  autoFocus: true,
  useKittyKeyboard: {
    disambiguate: true,
    allKeysAsEscapes: true,
    events: true,
  },
});

createRoot(renderer).render(<App />);
