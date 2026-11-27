import { joinSession, createCanvas } from "@github/copilot-sdk/extension";
import { createRuntime } from "./src/canvas.mjs";

let session;
const { canvas, shutdown } = createRuntime(() => session, { createCanvas });
session = await joinSession({ canvases: [canvas] });

process.once("SIGTERM", () => shutdown().finally(() => process.exit(0)));
