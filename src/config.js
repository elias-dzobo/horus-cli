import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const CONFIG_FILE = "horus.config.yaml";
const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * @returns {Promise<HorusConfig>}
 */
export async function loadConfig() {
  const configPath = path.resolve(CONFIG_FILE);

  try {
    const raw = await fs.readFile(configPath, "utf8");
    const parsed = YAML.parse(raw) ?? {};
    return normalizeConfig(parsed);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return normalizeConfig({});
    }

    throw error;
  }
}

/**
 * @returns {Promise<void>}
 */
export async function initProject() {
  await copyTemplate("horus.config.yaml", CONFIG_FILE);

  await fs.mkdir("journeys", { recursive: true });
  await copyTemplate("first-journey.yaml.example", path.join("journeys", "first-journey.yaml.example"));
}

/**
 * @param {HorusConfig} config
 * @returns {Promise<string[]>}
 */
export async function listJourneyFiles(config) {
  const dir = path.resolve(config.journeys_dir);
  const entries = await fs.readdir(dir, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isFile() && /\.(ya?ml|json)$/i.test(entry.name))
    .map((entry) => path.join(dir, entry.name))
    .sort();
}

/**
 * @param {string} filePath
 * @param {string} content
 */
async function writeIfMissing(filePath, content) {
  try {
    await fs.writeFile(filePath, content, { flag: "wx" });
    console.log(`Created ${filePath}`);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") {
      console.log(`Exists ${filePath}`);
      return;
    }

    throw error;
  }
}

/**
 * @param {string} templateName
 * @param {string} targetPath
 */
async function copyTemplate(templateName, targetPath) {
  const templatePath = path.join(PACKAGE_ROOT, "templates", templateName);
  const content = await fs.readFile(templatePath, "utf8");
  await writeIfMissing(targetPath, content);
}

/**
 * @param {Record<string, unknown>} raw
 * @returns {HorusConfig}
 */
function normalizeConfig(raw) {
  return {
    journeys_dir: readString(raw, "journeys_dir", "journeys"),
    artifacts_dir: readString(raw, "artifacts_dir", "artifacts/runs"),
    headed: readBoolean(raw, "headed", false),
    openai_model: readOptionalString(raw, "openai_model"),
    cloud: readCloudConfig(raw.cloud)
  };
}

/**
 * @param {unknown} raw
 */
function readCloudConfig(raw) {
  const config = raw && typeof raw === "object" ? /** @type {Record<string, unknown>} */ (raw) : {};

  return {
    dashboard_url: readOptionalString(config, "dashboard_url"),
    project_id: readOptionalString(config, "project_id")
  };
}

/**
 * @param {Record<string, unknown>} raw
 * @param {string} key
 * @param {string} fallback
 */
function readString(raw, key, fallback) {
  const value = raw[key];
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

/**
 * @param {Record<string, unknown>} raw
 * @param {string} key
 */
function readOptionalString(raw, key) {
  const value = raw[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * @param {Record<string, unknown>} raw
 * @param {string} key
 * @param {boolean} fallback
 */
function readBoolean(raw, key, fallback) {
  const value = raw[key];
  return typeof value === "boolean" ? value : fallback;
}

/**
 * @typedef {Object} HorusConfig
 * @property {string} journeys_dir
 * @property {string} artifacts_dir
 * @property {boolean} headed
 * @property {string=} openai_model
 * @property {{ dashboard_url?: string, project_id?: string }} cloud
 */
