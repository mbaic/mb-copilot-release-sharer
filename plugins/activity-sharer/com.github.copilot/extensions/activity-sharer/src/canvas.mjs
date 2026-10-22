// Canvas wiring: the only module that knows the Copilot SDK shapes.
// The SDK's createCanvas is injected by extension.mjs, so this module is testable without the SDK.
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { startInstanceServer } from "./server.mjs";
import * as ghMod from "./gh.mjs";
import { createLogger } from "./log.mjs";
import { RANGES } from "../lib/query.mjs";
import { aggregate } from "../lib/aggregate.mjs";
import { summarize } from "../lib/summary.mjs";
import { AUDIENCES, buildWriteupPrompt, compactActivity, sanitizeDraft } from "../lib/writeup.mjs";

const EXT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RANGE_PROP = { type: "string", enum: Object.keys(RANGES), description: "Period: 7d, 30d (default), 90d (quarter), 6m or 12m. Rolling windows ending now." };
const ORGS_PROP = { type: "array", items: { type: "string" }, description: "Optional GitHub organization or user logins to include. Default: all." };
const ORG_RE = /^[A-Za-z0-9-]{1,39}$/;

export function createRuntime(getSession, deps = {}) {
  const gh = deps.github ?? ghMod;
  const startServer = deps.startInstanceServer ?? startInstanceServer;
  const log = deps.log ?? createLogger(getSession);
  const loader = deps.loader ?? gh.createActivityLoader({ exec: deps.exec ?? gh.defaultExec });
  const extDir = deps.extDir ?? EXT_DIR;
  const version = deps.version ?? JSON.parse(readFileSync(path.join(extDir, "package.json"), "utf8")).version;
  const now = deps.now ?? (() => new Date());
  const instances = new Map(); // instanceId -> { sessionId, server }

  const sessionInstances = (sessionId) => [...instances.values()].filter((i) => i.sessionId === sessionId);

  /** Loads a range and builds the shared view model; throws a readable Error on failure. */
  async function modelFor({ range = "30d", orgs = [], force = false }) {
    if (!RANGES[range]) throw new Error(`range must be one of ${Object.keys(RANGES).join(", ")}`);
    if (!Array.isArray(orgs) || orgs.length > 50 || !orgs.every((o) => typeof o === "string" && ORG_RE.test(o))) throw new Error("orgs must be a list of GitHub logins");
    const res = await loader.load({ range, force });
    if (res.error) throw new Error(res.error.hint ? `${res.error.message} ${res.error.hint}` : res.error.message);
    return { model: aggregate(res.data, res.windows, { orgs, now: now() }), partial: res.partial ?? [] };
  }

  async function writeup({ audience, range, orgs }) {
    if (!AUDIENCES[audience]) throw new Error("Unknown audience");
    const { model } = await modelFor({ range, orgs });
    const prompt = buildWriteupPrompt(audience, model);
    await getSession().send({ prompt, mode: "immediate", displayPrompt: `Write a ${AUDIENCES[audience].label} from my GitHub activity (${range}${orgs?.length ? `, ${orgs.join(", ")}` : ""})` });
  }

  async function open(ctx) {
    let inst = instances.get(ctx.instanceId);
    if (!inst) {
      inst = { sessionId: ctx.sessionId, server: null };
      inst.server = await startServer({ extDir, version, log, loadActivity: ({ range, force }) => loader.load({ range, force }), writeup });
      instances.set(ctx.instanceId, inst);
    }
    return { title: "Activity Sharer", status: `v${version}`, url: inst.server.url };
  }

  async function onClose(ctx) {
    const inst = instances.get(ctx.instanceId);
    if (!inst) return;
    instances.delete(ctx.instanceId);
    await inst.server.stop();
  }

  const schema = (properties, required) => ({ type: "object", properties, additionalProperties: false, ...(required ? { required } : {}) });

  const actions = [
    {
      name: "get_activity",
      description: "Return the signed-in GitHub user's own activity for a period as compact, complete JSON: PRs merged, PRs opened, reviews given, issues opened (counts, previous-period counts, items with URLs), insights, open PRs, review requests waiting, repo breakdown and data limits. Use it for any question about what the user did, shipped or reviewed, and for standups, 1:1s, self-reviews and client updates. Cite only items and numbers it returns.",
      inputSchema: schema({ range: RANGE_PROP, orgs: ORGS_PROP, org: { type: "string", description: "Single organization or user login (same as orgs with one entry)." } }),
      handler: async (ctx) => {
        const a = ctx.input ?? {};
        if (a.orgs !== undefined && !Array.isArray(a.orgs)) throw new Error("orgs must be a list of GitHub logins");
        const { model, partial } = await modelFor({ range: a.range ?? "30d", orgs: [...(a.orgs ?? []), ...(a.org ? [a.org] : [])] });
        return { ...compactActivity(model), summary: summarize(model), ...(partial.length ? { partialErrors: partial } : {}) };
      },
    },
    {
      name: "set_draft",
      description: "Put a written-up draft into the open Activity Sharer canvas. The canvas checks every link and number against the user's data and shows the result; the user reviews and copies it. Plain text, 1 to 4000 characters. Use it after being asked for a standup, 1:1 or self-review, or client update.",
      inputSchema: schema({
        audience: { type: "string", enum: Object.keys(AUDIENCES), description: "standup, review or client." },
        text: { type: "string", description: "The draft, plain text (1 to 4000 characters)." },
      }, ["audience", "text"]),
      handler: async (ctx) => {
        const a = ctx.input ?? {};
        if (!AUDIENCES[a.audience]) throw new Error(`audience must be one of ${Object.keys(AUDIENCES).join(", ")}`);
        const text = sanitizeDraft(a.text);
        const open = sessionInstances(ctx.sessionId);
        if (!open.length) throw new Error("The Activity Sharer canvas is not open. Open it first.");
        for (const i of open) i.server.broadcast("draft", { audience: a.audience, text });
        return { ok: true };
      },
    },
  ];

  const canvas = (deps.createCanvas ?? ((def) => def))({
    id: "activity-sharer",
    displayName: "Activity Sharer",
    description: "What you shipped, reviewed and left open on GitHub for a chosen period, with an evidence-checked write-up for standups, 1:1s and client updates.",
    inputSchema: schema({}),
    actions,
    open,
    onClose,
  });

  return { canvas, shutdown: async () => {} };
}
