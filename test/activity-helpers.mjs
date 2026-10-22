import { fixture } from "./helpers.mjs";
import { aggregate } from "../plugins/activity-sharer/com.github.copilot/extensions/activity-sharer/lib/aggregate.mjs";
import { windowsFor } from "../plugins/activity-sharer/com.github.copilot/extensions/activity-sharer/lib/query.mjs";

export const NOW = new Date("2026-10-22T12:00:00Z");
export const response = () => structuredClone(fixture("activity.response.json"));
export const data = () => response().data;
export const windows = (range = "30d") => windowsFor(range, NOW);
export const model = (opts = {}, d = data(), range = "30d") => aggregate(d, windows(range), { now: NOW, ...opts });
