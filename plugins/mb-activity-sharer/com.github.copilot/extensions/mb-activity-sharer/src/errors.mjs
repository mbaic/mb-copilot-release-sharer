// gh error mapping (copy of the small wrapper pattern used by Release Sharer; no shared package by design).
const TEXT = {
  gh_missing: ["GitHub CLI (gh) was not found.", "Install it from https://cli.github.com and run `gh auth login`."],
  gh_not_authenticated: ["GitHub CLI is not signed in.", "Run `gh auth login` in a terminal, then Refresh."],
  forbidden: ["GitHub denied access.", "If the organization uses SSO, authorize gh for it (`gh auth refresh`), then Refresh."],
  rate_limited: ["GitHub rate limit reached.", "Wait a while and Refresh."],
  timeout: ["GitHub did not answer in time.", "Check your connection and Refresh."],
  network: ["Could not reach GitHub.", "Check your network or proxy settings and Refresh."],
  bad_range: ["Unknown range.", "Use 7d, 30d, 90d, 6m or 12m."],
  unknown: ["Something went wrong talking to GitHub.", "Try Refresh. If it keeps failing, run `gh auth status` in a terminal."],
};

export function makeError(code, extra) {
  const [message, hint] = TEXT[code] ?? TEXT.unknown;
  return { code, message, hint, ...extra };
}

function parseResetAt(text) {
  const m = /x-ratelimit-reset:\s*(\d{9,11})/i.exec(text);
  if (!m) return undefined;
  const d = new Date(Number(m[1]) * 1000);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/** Classifies a failed gh call from an exec error (or a plain stderr string). */
export function classifyGhError(e) {
  const isStr = typeof e === "string";
  const text = isStr ? e : `${e?.stderr ?? ""}\n${e?.message ?? ""}`;
  if (!isStr && e?.code === "ENOENT") return makeError("gh_missing");
  if (!isStr && (e?.code === "ETIMEDOUT" || e?.killed)) return makeError("timeout");
  if (/rate limit|abuse detection/i.test(text)) return makeError("rate_limited", { resetAt: parseResetAt(text) });
  if (/gh auth login|not logged in|HTTP 401|bad credentials/i.test(text)) return makeError("gh_not_authenticated");
  if (/HTTP 403|SAML|SSO|forbidden/i.test(text)) return makeError("forbidden");
  if (/no such host|ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN|dial tcp|could not resolve|network is unreachable|i\/o timeout|tls handshake|proxyconnect/i.test(text)) return makeError("network");
  return makeError("unknown");
}

/** GraphQL `errors[]` that come with usable data: SSO-style denials versus everything else. */
export function describeGraphqlErrors(errors) {
  const list = Array.isArray(errors) ? errors : [];
  return list.slice(0, 5).map((e) => ({
    kind: /saml|sso|forbidden/i.test(`${e?.type ?? ""} ${e?.message ?? ""}`) ? "sso" : "other",
    message: String(e?.message ?? "GitHub reported an error").slice(0, 300),
  }));
}
