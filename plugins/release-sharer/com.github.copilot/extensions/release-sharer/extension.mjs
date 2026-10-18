// M1 hello-world canvas: proves the plugin installs and the canvas opens (U5).
// Replaced by the real canvas module in M7. SDK shapes: PLAN section 3.1.
import { joinSession, createCanvas } from "@github/copilot-sdk/extension";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";

const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Release Sharer</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark"></head>
<body style="font-family: system-ui, sans-serif; margin: 1.5rem">
<h1>Release Sharer</h1><p>Hello from Release Sharer 0.1.0. The plugin is installed and the canvas opens.</p>
</body></html>`;

const instances = new Map(); // instanceId -> { server, url }

function startServer() {
  const token = randomBytes(24).toString("base64url");
  const server = createServer((req, res) => {
    if (req.method !== "GET" || req.url !== `/${token}/`) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": "default-src 'none'; style-src-attr 'unsafe-inline'; base-uri 'none'; form-action 'none'",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Cache-Control": "no-store",
    }).end(PAGE);
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve({ server, url: `http://127.0.0.1:${server.address().port}/${token}/` }));
  });
}

const canvas = createCanvas({
  id: "release-sharer",
  displayName: "Release Sharer",
  description: "Pick a release of the current repo and copy it as plain text, Markdown, email or rich HTML.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  actions: [],
  open: async (ctx) => {
    let inst = instances.get(ctx.instanceId);
    if (!inst) {
      inst = await startServer();
      instances.set(ctx.instanceId, inst);
    }
    return { title: "Release Sharer", status: "hello world (M1)", url: inst.url };
  },
  onClose: async (ctx) => {
    const inst = instances.get(ctx.instanceId);
    if (!inst) return;
    instances.delete(ctx.instanceId);
    inst.server.close();
    inst.server.closeAllConnections?.();
  },
});

await joinSession({ canvases: [canvas] });
