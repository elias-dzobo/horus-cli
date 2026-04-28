#!/usr/bin/env node
import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { initProject, listJourneyFiles, loadConfig } from "./config.js";
import { loadJourney } from "./journey-loader.js";
import { createIncident } from "./incident.js";
import { writeReports } from "./report-writer.js";
import { runJourney } from "./runner.js";

const args = process.argv.slice(2);
const wantsHelp = args.includes("--help") || args.includes("-h");
const wantsVersion = args.includes("--version") || args.includes("-v");
const explicitCommand = args[0] === "init" || args[0] === "run";
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
 * @param {{ artifactsRoot: string, headed: boolean, cloud: { dashboard_url?: string, project_id?: string } }} options
 */
async function runOne(journeyPath, options) {
  const journey = await loadJourney(journeyPath);
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
  console.error("  horus --version");
  console.error("");
  console.error("Examples:");
  console.error("  npm run run -- run journeys/agentic-contact.yaml");
  console.error("  npm run run -- run --all");
}
