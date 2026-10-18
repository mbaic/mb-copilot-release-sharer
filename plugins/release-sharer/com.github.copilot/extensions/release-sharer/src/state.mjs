// Persisted UI preferences (PLAN 7.4). Holds no secrets, release bodies or draft text.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { LIST, clamp } from "../lib/layout.mjs";
import { isValidRepo } from "./github.mjs";

const DEBOUNCE_MS = 300;
const FORMATS = ["plain", "markdown", "email", "html"];
const FILTERS = ["all", "stable", "pre"];
const AUDIENCES = ["Customers", "Internal"];
const MAX_WIDTH = 4000;

export function defaultStatePath() {
  const home = process.env.COPILOT_HOME || path.join(os.homedir(), ".copilot");
  return path.join(home, "extensions", "release-sharer", "state.json");
}

function defaults() {
  return {
    v: 1,
    ui: { listWidth: LIST.default, listCollapsed: false, format: "plain", clean: true, contributors: true, link: true, audience: "Customers" },
    repos: {},
    workdirs: {},
  };
}

const isObj = (o) => o !== null && typeof o === "object" && !Array.isArray(o);
const isBool = (b) => typeof b === "boolean";
const oneOf = (list) => (v) => list.includes(v);

const UI_RULES = {
  listWidth: [(n) => typeof n === "number" && Number.isFinite(n), (n) => Math.round(clamp(n, LIST.min, MAX_WIDTH))],
  listCollapsed: [isBool],
  format: [oneOf(FORMATS)],
  clean: [isBool],
  contributors: [isBool],
  link: [isBool],
  audience: [oneOf(AUDIENCES)],
};
const REPO_RULES = {
  lastTag: [(s) => typeof s === "string" && s.length > 0 && s.length <= 200],
  filter: [oneOf(FILTERS)],
};
const WORKDIR_RULES = { repoOverride: [isValidRepo] };

/** Keeps only known keys whose values pass their check. */
function pick(obj, rules) {
  const out = {};
  if (!isObj(obj)) return out;
  for (const [key, [ok, fix = (v) => v]] of Object.entries(rules)) {
    if (Object.hasOwn(obj, key) && ok(obj[key])) out[key] = fix(obj[key]);
  }
  return out;
}

function pickMap(map, keyOk, rules) {
  const out = {};
  if (!isObj(map)) return out;
  for (const [key, val] of Object.entries(map)) {
    if (key === "__proto__" || !keyOk(key)) continue;
    const entry = pick(val, rules);
    if (Object.keys(entry).length) out[key] = entry;
  }
  return out;
}

const workdirKey = (k) => k.length > 0 && k.length <= 1024;

/** The valid subset of a state-shaped object (used for both the file and patches). */
function sanitize(obj) {
  if (!isObj(obj)) return { ui: {}, repos: {}, workdirs: {} };
  return {
    ui: pick(obj.ui, UI_RULES),
    repos: pickMap(obj.repos, isValidRepo, REPO_RULES),
    workdirs: pickMap(obj.workdirs, workdirKey, WORKDIR_RULES),
  };
}

function merge(state, part) {
  Object.assign(state.ui, part.ui);
  for (const section of ["repos", "workdirs"]) {
    for (const [k, v] of Object.entries(part[section])) state[section][k] = { ...state[section][k], ...v };
  }
}

export function createState({ file = defaultStatePath(), setTimer = setTimeout, clearTimer = clearTimeout, fsImpl = fs } = {}) {
  const state = defaults();

  try {
    merge(state, sanitize(JSON.parse(fsImpl.readFileSync(file, "utf8"))));
  } catch (e) {
    if (e?.code !== "ENOENT") {
      try { fsImpl.renameSync(file, `${file}.bak`); } catch { /* best effort */ }
    }
  }

  let timer = null;
  let dirty = false;
  let chain = Promise.resolve();

  async function write() {
    const tmp = `${file}.tmp`;
    await fsImpl.promises.mkdir(path.dirname(file), { recursive: true });
    await fsImpl.promises.writeFile(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
    await fsImpl.promises.rename(tmp, file);
    try { await fsImpl.promises.chmod(file, 0o600); } catch { /* not supported on this OS */ }
  }

  function flush() {
    if (timer !== null) { clearTimer(timer); timer = null; }
    if (dirty) {
      dirty = false;
      chain = chain.then(write);
    }
    return chain;
  }

  function schedule() {
    dirty = true;
    if (timer !== null) clearTimer(timer);
    timer = setTimer(() => { timer = null; flush().catch(() => {}); }, DEBOUNCE_MS);
  }

  return {
    get: () => structuredClone(state),
    patch(patchObj) {
      merge(state, sanitize(patchObj));
      schedule();
    },
    flush,
    getRepoOverride: (cwd) => state.workdirs[cwd]?.repoOverride ?? null,
    /** Stores a manual owner/repo for a working directory; null clears it. Returns false for an invalid repo. */
    setRepoOverride(cwd, repo) {
      if (typeof cwd !== "string" || !workdirKey(cwd) || cwd === "__proto__") return false;
      if (repo === null) delete state.workdirs[cwd];
      else if (isValidRepo(repo)) state.workdirs[cwd] = { repoOverride: repo };
      else return false;
      schedule();
      return true;
    },
  };
}
