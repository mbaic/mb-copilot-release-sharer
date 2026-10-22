// Canvas wiring: the only module that knows the Copilot SDK shapes.
// The SDK's createCanvas is injected by extension.mjs, so this module is testable without the SDK.
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { startInstanceServer } from "./server.mjs";
import * as githubMod from "./github.mjs";
import { createState, defaultStatePath } from "./state.mjs";
import { createLogger } from "./log.mjs";
import { buildModel, mergePrs, prUrl, prsFromCommits } from "../lib/model.mjs";
import { format } from "../lib/formatters.mjs";
import { AUDIENCES, buildRewritePrompt, sanitizeDraft } from "./rewrite.mjs";

const EXT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FORMATS = ["plain", "markdown", "email", "html"];
const REPO_PROP = { type: "string", description: 'GitHub repository as "owner/repo". Defaults to the repository of the open canvas or the session folder.' };

export function createRuntime(getSession, deps = {}) {
  const gh = deps.github ?? githubMod;
  const startServer = deps.startInstanceServer ?? startInstanceServer;
  const state = deps.state ?? createState({ file: defaultStatePath() });
  const log = deps.log ?? createLogger(getSession);
  const loader = deps.loader ?? gh.createReleaseLoader({ exec: deps.exec ?? gh.defaultExec });
  const extDir = deps.extDir ?? EXT_DIR;
  const version = deps.version ?? JSON.parse(readFileSync(path.join(extDir, "package.json"), "utf8")).version;
  const instances = new Map(); // instanceId -> { cwd, sessionId, server, repo, repoError }
  const lastBySession = new Map(); // sessionId -> instanceId

  const parseFull = (s) => {
    if (!gh.isValidRepo(s)) return null;
    const [owner, repo] = s.split("/");
    return { owner, repo, full: `${owner}/${repo}` };
  };

  /** Repo for an instance: explicit canvas input, then saved override for the folder, then git remote. */
  async function resolveRepo(cwd, explicit) {
    const manual = parseFull(explicit ?? "") ?? parseFull(state.getRepoOverride(cwd) ?? "");
    if (manual) return { repo: manual };
    const det = await gh.detectRepo(cwd, { exec: deps.exec ?? gh.defaultExec });
    return det.error ? { repoError: det.error } : { repo: det };
  }

  /** Repo for an action: explicit argument, else the session's open canvas, else the session folder. */
  async function repoForAction(ctx, argRepo) {
    if (argRepo !== undefined) {
      const r = parseFull(argRepo);
      if (!r) throw new Error('repo must look like "owner/repo"');
      return r;
    }
    const inst = instances.get(lastBySession.get(ctx.sessionId));
    if (inst?.repo) return inst.repo;
    const cwd = ctx.session?.workingDirectory || process.cwd();
    const res = await resolveRepo(cwd);
    if (!res.repo) throw new Error(res.repoError?.message ?? "Could not detect a GitHub repository. Pass repo as owner/repo.");
    return res.repo;
  }

  const fail = (e) => { throw new Error(e.hint ? `${e.message} ${e.hint}` : e.message); };

  /** Finds a release by tag in the cache, loading further pages (max 5) when needed. */
  async function findRelease(r, tag) {
    if (typeof tag !== "string" || !tag) throw new Error("tag is required");
    for (let page = 1; page <= 5; page++) {
      const hit = loader.get(r.owner, r.repo, tag);
      if (hit) return hit;
      const res = await loader.load({ owner: r.owner, repo: r.repo, page });
      if (res.error) fail(res.error);
      if (!res.hasMore) break;
    }
    const hit = loader.get(r.owner, r.repo, tag);
    if (!hit) throw new Error(`Release ${tag} was not found in ${r.full}.`);
    return hit;
  }

  /**
   * Merged PRs for a release: those named in the notes plus those found in the commits since the previous
   * release. A failed or impossible compare still returns the notes' PRs, flagged `partial`.
   */
  async function prsFor(r, tag) {
    const release = await findRelease(r, tag);
    const fromNotes = buildModel(release).prs;
    let prev = loader.previous(r.owner, r.repo, tag);
    for (let page = 2; !prev && page <= 5; page++) { // the previous release may sit on a page not loaded yet
      const res = await loader.load({ owner: r.owner, repo: r.repo, page });
      if (res.error) break;
      prev = loader.previous(r.owner, r.repo, tag);
      if (!res.hasMore) break;
    }
    if (!prev) return { prs: fromNotes, partial: true };
    const cmp = await loader.compare({ owner: r.owner, repo: r.repo, base: prev.tag, head: tag });
    if (cmp.error) return { prs: fromNotes, partial: true };
    const found = prsFromCommits(cmp.commits).map((p) => ({ ...p, url: prUrl(r.full, p.number) }));
    return { prs: mergePrs(fromNotes, found), partial: cmp.truncated, base: prev.tag };
  }

  const sessionInstances = (sessionId) => [...instances.values()].filter((i) => i.sessionId === sessionId);

  async function rewrite(inst, { tag, audience }) {
    if (!AUDIENCES.includes(audience)) throw new Error("Unknown audience");
    if (!inst.repo) throw new Error("No repository");
    const release = await findRelease(inst.repo, tag);
    const model = buildModel(release);
    const text = format(model, { format: "plain", clean: true, contributors: false, link: false }).body;
    const prompt = buildRewritePrompt({ audience, tag: model.tag, title: model.title, dateLabel: model.dateLabel, text });
    await getSession().send({ prompt, mode: "immediate", displayPrompt: `Rewrite ${tag} release notes for ${audience}` });
  }

  async function open(ctx) {
    let inst = instances.get(ctx.instanceId);
    if (!inst) {
      const cwd = ctx.session?.workingDirectory || process.cwd();
      inst = { cwd, sessionId: ctx.sessionId, server: null, repo: null, repoError: null };
      Object.assign(inst, await resolveRepo(cwd, ctx.input?.repo));
      inst.server = await startServer({
        extDir, version, features: { rewrite: true }, log, state,
        getRepo: () => ({ repo: inst.repo?.full ?? null, ...(inst.repoError ? { repoError: inst.repoError } : {}) }),
        setRepo: async (s) => {
          const r = parseFull(String(s).trim());
          if (!r) return { error: { code: "invalid_repo", message: 'Enter the repository as "owner/repo".', hint: "" } };
          state.setRepoOverride(inst.cwd, r.full);
          inst.repo = r;
          inst.repoError = null;
          return { repo: r.full };
        },
        loadReleases: async ({ page, force }) => inst.repo
          ? loader.load({ owner: inst.repo.owner, repo: inst.repo.repo, page, force })
          : { error: inst.repoError ?? { code: "not_a_repo", message: "Could not detect a GitHub repository.", hint: "" } },
        rewrite: (req) => rewrite(inst, req),
        loadPrs: async ({ tag }) => {
          if (!inst.repo) return { error: { code: "not_a_repo", message: "Could not detect a GitHub repository.", hint: "" } };
          try { return await prsFor(inst.repo, tag); }
          catch (e) { return { error: { code: "unknown", message: String(e?.message ?? e), hint: "" } }; }
        },
      });
      instances.set(ctx.instanceId, inst);
      if (inst.repo && typeof ctx.input?.tag === "string") state.patch({ repos: { [inst.repo.full]: { lastTag: ctx.input.tag } } });
    }
    lastBySession.set(ctx.sessionId, ctx.instanceId);
    return { title: "Release Sharer", status: inst.repo?.full ?? "Repository not detected", url: inst.server.url };
  }

  async function onClose(ctx) {
    const inst = instances.get(ctx.instanceId);
    if (!inst) return;
    instances.delete(ctx.instanceId);
    if (lastBySession.get(ctx.sessionId) === ctx.instanceId) lastBySession.delete(ctx.sessionId);
    await inst.server.stop();
    await state.flush();
  }

  const schema = (properties, required) => ({ type: "object", properties, additionalProperties: false, ...(required ? { required } : {}) });
  const TAG = { type: "string", description: "Release tag, for example v2.4.1." };

  const actions = [
    {
      name: "list_releases",
      description: "List published releases of the repository (newest first): tag, name, date, pre-release and latest flags. Use it to find a tag before get_release, render_share or select_release.",
      inputSchema: schema({
        limit: { type: "integer", minimum: 1, maximum: 100, description: "How many releases to return. Default 30." },
        includePrerelease: { type: "boolean", description: "Include pre-releases. Default true." },
        repo: REPO_PROP,
      }),
      handler: async (ctx) => {
        const a = ctx.input ?? {};
        const r = await repoForAction(ctx, a.repo);
        const limit = Number.isInteger(a.limit) ? Math.min(100, Math.max(1, a.limit)) : 30;
        const res = await loader.load({ owner: r.owner, repo: r.repo, perPage: Math.min(100, limit) });
        if (res.error) fail(res.error);
        const releases = res.releases
          .filter((x) => a.includePrerelease !== false || !x.prerelease)
          .slice(0, limit)
          .map((x) => ({ tag: x.tag, name: x.name, date: x.publishedAt ?? x.createdAt, prerelease: x.prerelease, latest: x.latest }));
        return { repo: r.full, releases };
      },
    },
    {
      name: "get_release",
      description: "Get one release parsed into sections (items, contributors, links) so you can read or summarise it. Use list_releases first if you do not know the tag.",
      inputSchema: schema({ tag: TAG, repo: REPO_PROP }, ["tag"]),
      handler: async (ctx) => {
        const r = await repoForAction(ctx, ctx.input?.repo);
        return { repo: r.full, release: buildModel(await findRelease(r, ctx.input?.tag)) };
      },
    },
    {
      name: "render_share",
      description: "Render a release as shareable text in one format: plain, markdown, email (subject plus body) or html. Options: clean removes PR references and @mentions, contributors and link add the closing lines. Defaults: all on.",
      inputSchema: schema({
        tag: TAG,
        format: { type: "string", enum: FORMATS, description: "Output format." },
        options: schema({ clean: { type: "boolean" }, contributors: { type: "boolean" }, link: { type: "boolean" } }),
        repo: REPO_PROP,
      }, ["tag", "format"]),
      handler: async (ctx) => {
        const a = ctx.input ?? {};
        if (!FORMATS.includes(a.format)) throw new Error(`format must be one of ${FORMATS.join(", ")}`);
        const r = await repoForAction(ctx, a.repo);
        const model = buildModel(await findRelease(r, a.tag));
        const out = format(model, { format: a.format, repoLabel: r.full, ...(a.options ?? {}) });
        return { format: a.format, ...(out.subject !== undefined ? { subject: out.subject } : {}), body: a.format === "html" ? out.html : out.body, ...(a.format === "html" ? { text: out.body } : {}) };
      },
    },
    {
      name: "get_release_prs",
      description: "List the merged pull requests behind a release: PRs named in the notes plus those found in the commits since the previous release. Returns number, title and URL for each.",
      inputSchema: schema({ tag: TAG, repo: REPO_PROP }, ["tag"]),
      handler: async (ctx) => {
        const r = await repoForAction(ctx, ctx.input?.repo);
        return { repo: r.full, tag: ctx.input?.tag, ...(await prsFor(r, ctx.input?.tag)) };
      },
    },
    {
      name: "select_release",
      description: "Show a release in the open Release Sharer canvas (selects it in the list). Use it when the user asks to look at a specific release.",
      inputSchema: schema({ tag: TAG }, ["tag"]),
      handler: async (ctx) => {
        const tag = ctx.input?.tag;
        if (typeof tag !== "string" || !tag) throw new Error("tag is required");
        const open = sessionInstances(ctx.sessionId);
        if (!open.length) throw new Error("The Release Sharer canvas is not open. Open it first.");
        for (const i of open) i.server.broadcast("select", { tag });
        return { ok: true };
      },
    },
    {
      name: "set_draft",
      description: "Put rewritten release-note text into the open canvas preview as the draft body. The user still reviews and edits it before copying. Plain text only, 2 to 6 sentences unless the user asked otherwise. Use it after being asked to rewrite or shorten release notes for an audience.",
      inputSchema: schema({
        tag: TAG,
        text: { type: "string", description: "The rewritten plain text (1 to 4000 characters)." },
        note: { type: "string", description: "Optional short note for the user, for example the audience." },
      }, ["tag", "text"]),
      handler: async (ctx) => {
        const a = ctx.input ?? {};
        const open = sessionInstances(ctx.sessionId).filter((i) => i.repo);
        if (!open.length) throw new Error("The Release Sharer canvas is not open. Open it first.");
        const text = sanitizeDraft(a.text);
        if (typeof a.tag !== "string" || !a.tag) throw new Error("tag is required");
        const known = open.filter((i) => loader.get(i.repo.owner, i.repo.repo, a.tag));
        if (!known.length) throw new Error(`Release ${a.tag} is not loaded in the canvas. Select it in the canvas first.`);
        const note = typeof a.note === "string" ? a.note.slice(0, 200) : undefined;
        for (const i of known) i.server.broadcast("draft", { tag: a.tag, text, ...(note ? { note } : {}) });
        return { ok: true };
      },
    },
  ];

  const canvas = (deps.createCanvas ?? ((def) => def))({
    id: "release-sharer",
    displayName: "Release Sharer",
    description: "Pick a release of the current GitHub repo and copy it as plain text, Markdown, email or rich HTML.",
    inputSchema: schema({ repo: REPO_PROP, tag: { type: "string", description: "Release tag to show first." } }),
    actions,
    open,
    onClose,
  });

  return { canvas, shutdown: () => state.flush() };
}
