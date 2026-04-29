import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { runAgentTask } from "./agentic-worker.js";
import { stepLabel } from "./step-label.js";

/**
 * @param {import("./types.js").Journey} journey
 * @param {{ artifactsRoot?: string, headed?: boolean, project?: { name: string, id?: string }, environment?: { name: string, base_url?: string } }} options
 * @returns {Promise<import("./types.js").RunResult>}
 */
export async function runJourney(journey, options = {}) {
  const runId = createRunId(journey.name);
  const artifactsDir = path.resolve(options.artifactsRoot ?? "artifacts/runs", runId);
  const screenshotsDir = path.join(artifactsDir, "screenshots");
  await fs.mkdir(screenshotsDir, { recursive: true });
  const correlation = createCorrelation(runId, journey.name);

  /** @type {import("./types.js").ConsoleSignal[]} */
  const consoleSignals = [];
  /** @type {import("./types.js").NetworkSignal[]} */
  const networkSignals = [];
  /** @type {import("./types.js").StepRecord[]} */
  const stepRecords = [];

  const browser = await chromium.launch({ headless: !options.headed });
  const context = await browser.newContext({
    recordHar: { path: path.join(artifactsDir, "network.har"), mode: "minimal" }
  });
  const page = await context.newPage();

  page.on("console", (message) => {
    consoleSignals.push({
      type: message.type(),
      text: message.text(),
      timestamp: new Date().toISOString()
    });
  });

  page.on("response", (response) => {
    if (response.status() >= 400) {
      const request = response.request();
      networkSignals.push({
        url: response.url(),
        method: request.method(),
        ...classifyNetworkRequest(journey.base_url, request.url(), request.resourceType()),
        status: response.status(),
        status_text: response.statusText(),
        timestamp: new Date().toISOString()
      });
    }
  });

  page.on("requestfailed", (request) => {
    networkSignals.push({
      url: request.url(),
      method: request.method(),
      ...classifyNetworkRequest(journey.base_url, request.url(), request.resourceType()),
      failure: request.failure()?.errorText ?? "request failed",
      timestamp: new Date().toISOString()
    });
  });

  /** @type {import("./types.js").StepRecord | undefined} */
  let failedStep;
  /** @type {string | undefined} */
  let failureMessage;
  /** @type {string | undefined} */
  let domSnapshot;
  let finalUrl = "";

  try {
    for (let index = 0; index < journey.steps.length; index += 1) {
      const step = journey.steps[index];
      const label = stepLabel(step);
      const started = Date.now();
      const startedAt = new Date(started).toISOString();
      /** @type {import("./types.js").StepRecord} */
      const record = {
        index,
        label,
        status: /** @type {"passed" | "failed"} */ ("passed"),
        started_at: startedAt,
        finished_at: startedAt,
        duration_ms: 0
      };

      try {
        const stepResult = await executeStep(page, journey, step);
        if (stepResult.agent_actions) {
          record.agent_actions = stepResult.agent_actions;
        }
        const screenshot = path.join(screenshotsDir, `${String(index).padStart(2, "0")}-passed.png`);
        await page.screenshot({ path: screenshot, fullPage: true });
        record.screenshot = screenshot;
      } catch (error) {
        record.status = "failed";
        record.error = error instanceof Error ? error.message : String(error);
        const agentActions = error && typeof error === "object" && "agent_actions" in error ? error.agent_actions : undefined;
        if (Array.isArray(agentActions) && agentActions.every((action) => typeof action === "string")) {
          record.agent_actions = agentActions;
        }
        const screenshot = path.join(screenshotsDir, `${String(index).padStart(2, "0")}-failed.png`);
        await page.screenshot({ path: screenshot, fullPage: true });
        record.screenshot = screenshot;
        failedStep = record;
        failureMessage = record.error;
        domSnapshot = await page.content();
      } finally {
        const finished = Date.now();
        record.finished_at = new Date(finished).toISOString();
        record.duration_ms = finished - started;
        stepRecords.push(record);
      }

      if (failedStep) break;
    }
  } finally {
    finalUrl = page.url();
    await context.close();
    await browser.close();
  }

  return {
    schema_version: "horus.run.v1",
    run_id: runId,
    project: options.project ?? { name: "unknown" },
    environment: options.environment ?? { name: "local" },
    artifacts_dir: artifactsDir,
    journey,
    steps: stepRecords,
    console: consoleSignals,
    network: networkSignals,
    final_url: finalUrl,
    passed: !failedStep,
    failed_step: failedStep,
    failure_message: failureMessage,
    dom_snapshot: domSnapshot ? path.join(artifactsDir, "dom.html") : undefined,
    dom_snapshot_content: domSnapshot,
    repro: {
      command: `horus run ${journey.source_path ?? "<journey-file>"}`,
      journey_file: journey.source_path,
      base_url: journey.base_url,
      run_id: runId
    },
    correlation
  };
}

/**
 * @param {string} appBaseUrl
 * @param {string} requestUrl
 * @param {string} resourceType
 */
function classifyNetworkRequest(appBaseUrl, requestUrl, resourceType) {
  const appUrl = safeUrl(appBaseUrl);
  const url = safeUrl(requestUrl);
  const appRelevant = Boolean(url && appUrl && isAppRelevantUrl(appUrl, url, resourceType));
  const asset = ["font", "image", "stylesheet", "media"].includes(resourceType);
  const category = appRelevant ? "app" : asset ? "asset" : isKnownNoiseUrl(url) ? "noise" : "third_party";

  return {
    resource_type: resourceType,
    category: /** @type {"app" | "third_party" | "asset" | "noise"} */ (category),
    app_relevant: appRelevant,
    ignored: !appRelevant
  };
}

/**
 * @param {URL | null} appUrl
 * @param {URL | null} url
 * @param {string} resourceType
 */
function isAppRelevantUrl(appUrl, url, resourceType) {
  if (!url || !appUrl) return false;
  if (url.origin === appUrl.origin) return true;
  if (isLocalHost(appUrl.hostname) && isLocalHost(url.hostname) && ["fetch", "xhr", "document", "websocket"].includes(resourceType)) {
    return true;
  }
  return false;
}

/**
 * @param {string} hostname
 */
function isLocalHost(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

/**
 * @param {URL | null} url
 */
function isKnownNoiseUrl(url) {
  if (!url) return false;
  return ["fonts.gstatic.com", "fonts.googleapis.com"].includes(url.hostname);
}

/**
 * @param {string} raw
 */
function safeUrl(raw) {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

/**
 * @param {import("playwright").Page} page
 * @param {import("./types.js").Journey} journey
 * @param {import("./types.js").JourneyStep} step
 * @returns {Promise<{ agent_actions?: string[] }>}
 */
async function executeStep(page, journey, step) {
  if ("goto" in step) {
    await page.goto(resolveUrl(journey.base_url, step.goto), { waitUntil: "domcontentloaded" });
    return {};
  }

  if ("click" in step) {
    await page.locator(step.click).click();
    return {};
  }

  if ("fill" in step) {
    await page.locator(step.fill.selector).fill(step.fill.value);
    return {};
  }

  if ("upload" in step) {
    await page.locator(step.upload.selector).setInputFiles(step.upload.file);
    return {};
  }

  if ("agent" in step) {
    const actions = await runAgentTask(page, step.agent);
    return { agent_actions: actions };
  }

  if ("expect_text" in step) {
    await page.getByText(step.expect_text).first().waitFor({ state: "visible", timeout: 10_000 });
    return {};
  }

  if ("expect_url_contains" in step) {
    await page.waitForURL((url) => url.toString().includes(step.expect_url_contains), { timeout: 10_000 });
    return {};
  }

  if ("wait_for_selector" in step) {
    await page.locator(step.wait_for_selector).waitFor({ state: "visible", timeout: 10_000 });
    return {};
  }

  if ("wait_ms" in step) {
    await page.waitForTimeout(step.wait_ms);
    return {};
  }

  throw new Error(`Unsupported step: ${JSON.stringify(step)}`);
}

/**
 * @param {string} baseUrl
 * @param {string} target
 */
function resolveUrl(baseUrl, target) {
  return new URL(target, baseUrl).toString();
}

/**
 * @param {string} journeyName
 */
function createRunId(journeyName) {
  const timestamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
  const safeName = journeyName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${timestamp}-${safeName}`;
}

/**
 * @param {string} runId
 * @param {string} journeyName
 */
function createCorrelation(runId, journeyName) {
  const journeyId = journeyName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const sessionId = `${runId}-browser`;

  return {
    run_id: runId,
    journey_id: journeyId,
    session_id: sessionId,
    headers: {
      "x-horus-run-id": runId,
      "x-horus-journey-id": journeyId,
      "x-horus-session-id": sessionId
    }
  };
}
