#!/usr/bin/env node
import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { initProject, listJourneyFiles, loadConfig } from "./config.js";
import { loadJourney } from "./journey-loader.js";
import { createIncident } from "./incident.js";
import { writeReports } from "./report-writer.js";
import { runJourney } from "./runner.js";

const args = process.argv.slice(2);
const wantsHelp = args.includes("--help") || args.includes("-h");
const wantsVersion = args.includes("--version") || args.includes("-v");
const explicitCommand = ["init", "run", "doctor", "runs", "upload"].includes(args[0] ?? "");
const command = explicitCommand ? args[0] : "run";
const positional = args.filter((arg) => !arg.startsWith("-"));
const headed = args.includes("--headed");
const runAll = args.includes("--all");

try {
  if (wantsHelp) {
    printUsage();
    process.exit(0);
  }

  if (wantsVersion) {
    console.log(await readPackageVersion());
    process.exit(0);
  }

  if (command === "init") {
    await initProject();
    process.exit(0);
  }

  if (command === "doctor") {
    await runDoctor();
    process.exit(0);
  }

  if (command === "runs") {
    const config = await loadConfig();
    await handleRunsCommand(positional, config.artifacts_dir);
    process.exit(0);
  }

  if (command === "upload") {
    const config = await loadConfig();
    await uploadPlaceholder(positional[1], config.artifacts_dir, config.cloud);
    process.exit(0);
  }

  if (command !== "run") {
    printUsage();
    process.exit(1);
  }

  const config = await loadConfig();
  if (config.openai_model && !process.env.HORUS_OPENAI_MODEL) {
    process.env.HORUS_OPENAI_MODEL = config.openai_model;
  }

  const journeyPath = positional[0] === "run" ? positional[1] : positional[0];
  const journeyFiles = runAll ? await listJourneyFiles(config) : journeyPath ? [journeyPath] : [];

  if (journeyFiles.length === 0) {
    printUsage();
    process.exit(1);
  }

  let failed = false;

  for (const file of journeyFiles) {
    const result = await runOne(file, {
      artifactsRoot: config.artifacts_dir,
      headed: headed || config.headed,
      project: config.project,
      environment: config.environment,
      cloud: config.cloud
    });
    failed ||= !result;
  }

  process.exitCode = failed ? 1 : 0;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

/**
 * @param {string} journeyPath
 * @param {{ artifactsRoot: string, headed: boolean, project: { name: string, id?: string }, environment: { name: string, base_url?: string }, cloud: { dashboard_url?: string, project_id?: string } }} options
 */
async function runOne(journeyPath, options) {
  const loadedJourney = await loadJourney(journeyPath);
  const journey = {
    ...loadedJourney,
    base_url: options.environment.base_url ?? loadedJourney.base_url
  };
  const result = await runJourney(journey, options);
  const incident = {
    ...createIncident(result),
    cloud: {
      dashboard_url: options.cloud.dashboard_url ?? null,
      project_id: options.cloud.project_id ?? null,
      upload_enabled: false
    }
  };
  await writeReports(result, incident);

  console.log(`${result.passed ? "PASS" : "FAIL"} ${journey.name}`);
  console.log(`Journey: ${path.relative(process.cwd(), journey.source_path ?? journeyPath)}`);
  console.log(`Artifacts: ${result.artifacts_dir}`);
  console.log(`Repair context: ${path.join(result.artifacts_dir, "repair-context.json")}`);
  if (options.cloud.dashboard_url) {
    console.log(`Cloud dashboard: ${options.cloud.dashboard_url} (upload disabled in v1)`);
  }

  if (!result.passed) {
    console.log(`Failed step: ${result.failed_step?.label ?? "unknown"}`);
    console.log(`Hypothesis: ${incident.root_cause_hypothesis}`);
  }

  return result.passed;
}

async function runDoctor() {
  const config = await loadConfig();
  const checks = [
    await checkNodeVersion(),
    await checkPath("Config file", "horus.config.yaml"),
    await checkPath("Journeys directory", config.journeys_dir),
    await checkPath("Artifacts directory", config.artifacts_dir, { optional: true }),
    {
      label: "OpenAI API key",
      ok: Boolean(process.env.OPENAI_API_KEY),
      detail: process.env.OPENAI_API_KEY ? "present" : "missing; agent mode will use only the fallback demo planner"
    },
    {
      label: "Playwright Chromium",
      ok: true,
      detail: chromium.executablePath()
    },
    {
      label: "Project",
      ok: true,
      detail: config.project.id ? `${config.project.name} (${config.project.id})` : config.project.name
    },
    {
      label: "Environment",
      ok: true,
      detail: config.environment.base_url ? `${config.environment.name}: ${config.environment.base_url}` : config.environment.name
    }
  ];

  console.log("Horus doctor");
  for (const check of checks) {
    console.log(`${check.ok ? "PASS" : "WARN"} ${check.label}: ${check.detail}`);
  }
}

/**
 * @param {string[]} positional
 * @param {string} artifactsRoot
 */
async function handleRunsCommand(positional, artifactsRoot) {
  const subcommand = positional[1] ?? "list";
  if (subcommand === "list") {
    await listRuns(artifactsRoot);
    return;
  }

  if (subcommand === "show") {
    await showRun(positional[2], artifactsRoot);
    return;
  }

  printUsage();
  process.exitCode = 1;
}

/**
 * @param {string} artifactsRoot
 */
async function listRuns(artifactsRoot) {
  const runs = await readRunManifests(artifactsRoot);
  if (runs.length === 0) {
    console.log(`No local runs found in ${path.resolve(artifactsRoot)}`);
    return;
  }

  for (const run of runs) {
    console.log(`${run.id}  ${run.status}  ${run.project?.name ?? "unknown"}  ${run.environment?.name ?? "local"}  ${run.journey?.name ?? "unknown"}`);
  }
}

/**
 * @param {string | undefined} runId
 * @param {string} artifactsRoot
 */
async function showRun(runId, artifactsRoot) {
  if (!runId) {
    throw new Error("Usage: horus runs show <run-id>");
  }

  const manifest = await readRunManifest(runId, artifactsRoot);
  console.log(JSON.stringify(manifest, null, 2));
}

/**
 * @param {string | undefined} runId
 * @param {string} artifactsRoot
 * @param {{ dashboard_url?: string, project_id?: string }} cloud
 */
async function uploadPlaceholder(runId, artifactsRoot, cloud) {
  if (!runId) {
    throw new Error("Usage: horus upload <run-id>");
  }

  const manifest = await readRunManifest(runId, artifactsRoot);
  console.log("Cloud upload is not enabled in this CLI version.");
  console.log(`Run is ready for upload: ${path.join(path.resolve(artifactsRoot), manifest.id, "run.json")}`);
  if (cloud.dashboard_url) {
    console.log(`Configured dashboard: ${cloud.dashboard_url}`);
  }
}

/**
 * @param {string} artifactsRoot
 */
async function readRunManifests(artifactsRoot) {
  const root = path.resolve(artifactsRoot);
  let entries = [];
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }

  const manifests = await Promise.all(entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => readJson(path.join(root, entry.name, "run.json")).catch(() => null)));

  return manifests
    .filter((manifest) => manifest && typeof manifest === "object")
    .sort((a, b) => String(b.finished_at ?? "").localeCompare(String(a.finished_at ?? "")));
}

/**
 * @param {string} runId
 * @param {string} artifactsRoot
 */
async function readRunManifest(runId, artifactsRoot) {
  const manifestPath = path.join(path.resolve(artifactsRoot), runId, "run.json");
  return readJson(manifestPath);
}

/**
 * @param {string} filePath
 */
async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function checkNodeVersion() {
  const major = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
  return {
    label: "Node.js",
    ok: major >= 20,
    detail: process.version
  };
}

/**
 * @param {string} label
 * @param {string} target
 * @param {{ optional?: boolean }} options
 */
async function checkPath(label, target, options = {}) {
  try {
    await fs.access(target);
    return { label, ok: true, detail: path.resolve(target) };
  } catch {
    return { label, ok: Boolean(options.optional), detail: options.optional ? "will be created on first run" : `missing: ${path.resolve(target)}` };
  }
}

async function readPackageVersion() {
  const packageJsonPath = new URL("../package.json", import.meta.url);
  const raw = await fs.readFile(packageJsonPath, "utf8");
  const parsed = JSON.parse(raw);
  return typeof parsed.version === "string" ? parsed.version : "0.0.0";
}

function printUsage() {
  console.error("Usage:");
  console.error("  horus init");
  console.error("  horus run <journey-file> [--headed]");
  console.error("  horus run --all [--headed]");
  console.error("  horus doctor");
  console.error("  horus runs list");
  console.error("  horus runs show <run-id>");
  console.error("  horus upload <run-id>");
  console.error("  horus --version");
  console.error("");
  console.error("Examples:");
  console.error("  npm run run -- run journeys/agentic-contact.yaml");
  console.error("  npm run run -- run --all");
}
