#!/usr/bin/env node
import "dotenv/config";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { chromium } from "playwright";
import { initProject, listJourneyFiles, loadConfig } from "./config.js";
import { loadJourney } from "./journey-loader.js";
import { createIncident } from "./incident.js";
import { writeReports } from "./report-writer.js";
import { runJourney } from "./runner.js";

const execFileAsync = promisify(execFile);

const args = process.argv.slice(2);
const wantsHelp = args.includes("--help") || args.includes("-h");
const wantsVersion = args.includes("--version") || args.includes("-v");
const explicitCommand = ["init", "run", "doctor", "runs", "upload", "repair-context", "codex", "github"].includes(args[0] ?? "");
const command = explicitCommand ? args[0] : "run";
const positional = args.filter((arg) => !arg.startsWith("-"));
const headed = args.includes("--headed");
const runAll = args.includes("--all");
const dryRun = args.includes("--dry-run");

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

  if (command === "repair-context") {
    const config = await loadConfig();
    await printRepairContext(positional[1], config.artifacts_dir);
    process.exit(0);
  }

  if (command === "codex") {
    const config = await loadConfig();
    await printCodexPrompt(positional[1], config.artifacts_dir);
    process.exit(0);
  }

  if (command === "github") {
    const config = await loadConfig();
    await handleGithubCommand(positional, config.artifacts_dir, dryRun);
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
  const runSummaries = [];

  for (const file of journeyFiles) {
    const summary = await runOne(file, {
      artifactsRoot: config.artifacts_dir,
      headed: headed || config.headed,
      project: config.project,
      environment: config.environment,
      cloud: config.cloud
    });
    runSummaries.push(summary);
    failed ||= !summary.passed;
  }

  if (runSummaries.length > 1) {
    printRunSummary(runSummaries);
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

  return {
    passed: result.passed,
    journey: journey.name,
    artifacts_dir: result.artifacts_dir,
    repair_context: path.join(result.artifacts_dir, "repair-context.json"),
    failed_step: result.failed_step?.label ?? null,
    failure_type: incident.failure_type,
    severity: incident.severity,
    root_cause_hypothesis: incident.root_cause_hypothesis
  };
}

/**
 * @param {Array<{ passed: boolean, journey: string, artifacts_dir: string, repair_context: string, failed_step: string | null, failure_type: string, severity: string, root_cause_hypothesis: string }>} summaries
 */
function printRunSummary(summaries) {
  const passed = summaries.filter((summary) => summary.passed).length;
  const failed = summaries.length - passed;

  console.log("");
  console.log("Horus run summary");
  console.log(`Journeys: ${summaries.length} total, ${passed} passed, ${failed} failed`);

  if (failed === 0) return;

  console.log("");
  console.log("Failures");
  for (const summary of summaries.filter((item) => !item.passed)) {
    console.log(`- ${summary.journey}: ${summary.failure_type} (${summary.severity})`);
    console.log(`  Step: ${summary.failed_step ?? "unknown"}`);
    console.log(`  Hypothesis: ${summary.root_cause_hypothesis}`);
    console.log(`  Repair context: ${summary.repair_context}`);
  }
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

  if (subcommand === "latest") {
    await printLatestRun(artifactsRoot, args.includes("--failed"));
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
 * @param {string} artifactsRoot
 * @param {boolean} failedOnly
 */
async function printLatestRun(artifactsRoot, failedOnly) {
  const runs = await readRunManifests(artifactsRoot);
  const matches = failedOnly ? runs.filter((run) => run.status === "failed") : runs;
  const latest = matches[0];

  if (!latest) {
    throw new Error(failedOnly ? "No failed Horus runs found." : "No Horus runs found.");
  }

  console.log(latest.id);
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
 * @param {string | undefined} runId
 * @param {string} artifactsRoot
 */
async function printRepairContext(runId, artifactsRoot) {
  if (!runId) {
    throw new Error("Usage: horus repair-context <run-id>");
  }

  const context = await readRunArtifact(runId, artifactsRoot, "repair-context.json");
  console.log(JSON.stringify(context, null, 2));
}

/**
 * @param {string | undefined} runId
 * @param {string} artifactsRoot
 */
async function printCodexPrompt(runId, artifactsRoot) {
  if (!runId) {
    throw new Error("Usage: horus codex <run-id>");
  }

  const manifest = await readRunManifest(runId, artifactsRoot);
  const context = await readRunArtifact(runId, artifactsRoot, "repair-context.json");
  const contextPath = path.join(path.resolve(artifactsRoot), runId, "repair-context.json");
  const reportPath = path.join(path.resolve(artifactsRoot), runId, "report.md");
  const failure = context && typeof context === "object" && "failure" in context ? context.failure : {};
  const repro = context && typeof context === "object" && "repro" in context ? context.repro : manifest.repro;
  const passed = manifest.status === "passed";

  console.log(`# ${passed ? "Horus Run Review Task" : "Horus Repair Task"}

${passed ? "This Horus run passed. Use the context for review, documentation, or follow-up investigation; no repair is currently needed." : "Use the Horus repair context to investigate and fix this failed journey."}

Run ID: ${manifest.id}
Project: ${manifest.project?.name ?? "unknown"}
Environment: ${manifest.environment?.name ?? "local"}
Journey: ${manifest.journey?.name ?? "unknown"}
Failure type: ${readNestedString(failure, "type", "unknown")}
Severity: ${readNestedString(failure, "severity", "unknown")}
Failed step: ${readNestedString(failure, "step", "unknown")}

Root-cause hypothesis:
${readNestedString(failure, "root_cause_hypothesis", "No hypothesis available.")}

Recommended action:
${readNestedString(failure, "recommended_action", "Inspect the repair context and captured evidence.")}

Important files:
- Repair context: ${contextPath}
- Markdown report: ${reportPath}

Reproduce with:
\`\`\`bash
${readNestedString(repro, "command", `horus run ${manifest.journey?.source_path ?? "<journey-file>"}`)}
\`\`\`

Expected workflow:
1. Read the repair context and report.
2. Inspect the app code related to the suspected layer and failing journey.
3. Make the smallest safe fix.
4. Run the relevant checks and rerun the Horus repro command.
5. Summarize the root cause, fix, checks, and any residual risk.`);
}

/**
 * @param {string[]} positional
 * @param {string} artifactsRoot
 * @param {boolean} dryRun
 */
async function handleGithubCommand(positional, artifactsRoot, dryRun) {
  const subcommand = positional[1];
  if (subcommand !== "issue") {
    throw new Error("Usage: horus github issue <run-id> [--dry-run]");
  }

  await createGithubIssue(positional[2], artifactsRoot, dryRun);
}

/**
 * @param {string | undefined} runId
 * @param {string} artifactsRoot
 * @param {boolean} dryRun
 */
async function createGithubIssue(runId, artifactsRoot, dryRun) {
  if (!runId) {
    throw new Error("Usage: horus github issue <run-id> [--dry-run]");
  }

  const manifest = await readRunManifest(runId, artifactsRoot);
  const context = await readRunArtifact(runId, artifactsRoot, "repair-context.json");
  const issue = buildGithubIssue(manifest, context, path.join(path.resolve(artifactsRoot), runId));

  if (dryRun) {
    console.log(`# ${issue.title}`);
    console.log("");
    console.log(issue.body);
    return;
  }

  const { stdout } = await execFileAsync("gh", ["issue", "create", "--title", issue.title, "--body", issue.body]);
  console.log(stdout.trim());
}

/**
 * @param {any} manifest
 * @param {unknown} context
 * @param {string} runDir
 */
function buildGithubIssue(manifest, context, runDir) {
  const contextObject = context && typeof context === "object" ? /** @type {Record<string, unknown>} */ (context) : {};
  const failure = readNestedObject(contextObject, "failure");
  const evidence = readNestedObject(contextObject, "evidence");
  const browser = readNestedObject(evidence, "browser");
  const repro = readNestedObject(contextObject, "repro");
  const journeyName = manifest.journey?.name ?? "unknown journey";
  const failureType = readNestedString(failure, "type", "unknown");
  const status = manifest.status ?? "unknown";
  const reportPath = path.join(runDir, "report.md");
  const repairContextPath = path.join(runDir, "repair-context.json");

  const title = status === "failed"
    ? `Horus: ${journeyName} failed (${failureType})`
    : `Horus: ${journeyName} ${status}`;

  const body = `## Horus Incident

- Run ID: ${manifest.id}
- Project: ${manifest.project?.name ?? "unknown"}
- Environment: ${manifest.environment?.name ?? "local"}
- Journey: ${journeyName}
- Status: ${status}
- Failure type: ${failureType}
- Severity: ${readNestedString(failure, "severity", "unknown")}
- Failed step: ${readNestedString(failure, "step", "none")}

## Root-Cause Hypothesis

${readNestedString(failure, "root_cause_hypothesis", "No hypothesis available.")}

## Recommended Action

${readNestedString(failure, "recommended_action", "Inspect the Horus report and repair context.")}

## Evidence

- Screenshot: ${readNestedString(browser, "screenshot", "none")}
- DOM snapshot: ${readNestedString(browser, "dom_snapshot", "none")}
- Report: ${reportPath}
- Repair context: ${repairContextPath}

## Reproduce

\`\`\`bash
${readNestedString(repro, "command", `horus run ${manifest.journey?.source_path ?? "<journey-file>"}`)}
\`\`\`

## Repair-Agent Handoff

\`\`\`bash
horus codex ${manifest.id}
\`\`\`
`;

  return { title, body };
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
 * @param {string} runId
 * @param {string} artifactsRoot
 * @param {string} fileName
 */
async function readRunArtifact(runId, artifactsRoot, fileName) {
  const filePath = path.join(path.resolve(artifactsRoot), runId, fileName);
  return readJson(filePath);
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

/**
 * @param {unknown} value
 * @param {string} key
 * @param {string} fallback
 */
function readNestedString(value, key, fallback) {
  if (!value || typeof value !== "object") return fallback;
  const nested = /** @type {Record<string, unknown>} */ (value)[key];
  return typeof nested === "string" && nested.length > 0 ? nested : fallback;
}

/**
 * @param {unknown} value
 * @param {string} key
 * @returns {Record<string, unknown>}
 */
function readNestedObject(value, key) {
  if (!value || typeof value !== "object") return {};
  const nested = /** @type {Record<string, unknown>} */ (value)[key];
  return nested && typeof nested === "object" && !Array.isArray(nested) ? /** @type {Record<string, unknown>} */ (nested) : {};
}

function printUsage() {
  console.error("Usage:");
  console.error("  horus init");
  console.error("  horus run <journey-file> [--headed]");
  console.error("  horus run --all [--headed]");
  console.error("  horus doctor");
  console.error("  horus runs list");
  console.error("  horus runs show <run-id>");
  console.error("  horus runs latest [--failed]");
  console.error("  horus repair-context <run-id>");
  console.error("  horus codex <run-id>");
  console.error("  horus github issue <run-id> [--dry-run]");
  console.error("  horus upload <run-id>");
  console.error("  horus --version");
  console.error("");
  console.error("Examples:");
  console.error("  npm run run -- run journeys/agentic-contact.yaml");
  console.error("  npm run run -- run --all");
}
