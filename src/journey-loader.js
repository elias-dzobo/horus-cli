import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import YAML from "yaml";

/**
 * @param {string} filePath
 * @returns {Promise<import("./types.js").Journey>}
 */
export async function loadJourney(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  const extension = path.extname(filePath).toLowerCase();
  const parsedRaw = resolveEnvPlaceholders(extension === ".json" ? JSON.parse(raw) : YAML.parse(raw));

  if (!parsedRaw || typeof parsedRaw !== "object" || Array.isArray(parsedRaw)) {
    throw new Error("Journey file must contain an object.");
  }

  const parsed = /** @type {Record<string, unknown>} */ (parsedRaw);

  if (typeof parsed.name !== "string" || parsed.name.length === 0) {
    throw new Error("Journey requires a non-empty name.");
  }

  if (typeof parsed.base_url !== "string" || parsed.base_url.length === 0) {
    throw new Error("Journey requires a non-empty base_url.");
  }

  const steps = normalizeSteps(parsed);

  return {
    ...parsed,
    name: parsed.name,
    base_url: normalizeBaseUrl(parsed.base_url, filePath),
    steps,
    source_path: path.resolve(filePath)
  };
}

/**
 * @param {unknown} value
 * @returns {unknown}
 */
function resolveEnvPlaceholders(value) {
  if (typeof value === "string") {
    return value.replace(/\{\{env\.([A-Z0-9_]+)\}\}/gi, (_match, name) => process.env[String(name)] ?? "");
  }

  if (Array.isArray(value)) {
    return value.map((item) => resolveEnvPlaceholders(item));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, resolveEnvPlaceholders(nested)])
    );
  }

  return value;
}

/**
 * @param {Record<string, unknown>} parsed
 * @returns {import("./types.js").JourneyStep[]}
 */
function normalizeSteps(parsed) {
  if (Array.isArray(parsed.steps) && parsed.steps.length > 0) {
    return parsed.steps;
  }

  if (typeof parsed.goal === "string" && parsed.goal.length > 0) {
    const inputs = typeof parsed.inputs === "object" && parsed.inputs !== null
      ? /** @type {Record<string, unknown>} */ (parsed.inputs)
      : undefined;
    /** @type {import("./types.js").JourneyStep[]} */
    const steps = [
      { goto: "" },
      {
        agent: {
          goal: parsed.goal,
          inputs,
          max_steps: typeof parsed.max_steps === "number" ? parsed.max_steps : undefined
        }
      }
    ];

    if (typeof parsed.success_text === "string" && parsed.success_text.length > 0) {
      steps.push({ expect_text: parsed.success_text });
    }

    return steps;
  }

  throw new Error("Journey requires either steps or a top-level goal.");
}

/**
 * @param {string} baseUrl
 * @param {string} journeyPath
 */
function normalizeBaseUrl(baseUrl, journeyPath) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(baseUrl)) return baseUrl;

  const journeyDir = path.dirname(path.resolve(journeyPath));
  return pathToFileURL(path.resolve(journeyDir, baseUrl)).toString();
}
