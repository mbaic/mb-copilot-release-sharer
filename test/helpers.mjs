import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const fixture = (name) => JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf8"));

/** Maps a raw GitHub API release to the shape buildModel takes (the real mapping is github.mjs, M3). */
export function toRelease(raw, extra = {}) {
  return {
    tag: raw.tag_name,
    name: raw.name,
    body: raw.body,
    prerelease: raw.prerelease,
    publishedAt: raw.published_at ?? null,
    createdAt: raw.created_at ?? null,
    url: raw.html_url,
    latest: false,
    ...extra,
  };
}

/** A minimal mapped release around a body, for parser tests. */
export const rel = (body, extra = {}) => ({ tag: "v1.0.0", name: null, body, publishedAt: "2026-01-02T00:00:00Z", url: "https://github.com/o/r/releases/tag/v1.0.0", ...extra });
