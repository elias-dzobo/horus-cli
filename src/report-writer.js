import fs from "node:fs/promises";
import path from "node:path";

/**
 * @param {import("./types.js").RunResult} result
 * @param {unknown} incident
 */
export async function writeReports(result, incident) {
  await fs.writeFile(
    path.join(result.artifacts_dir, "run.json"),
    `${JSON.stringify(createRunManifest(result, incident), null, 2)}\n`
  );

  await fs.writeFile(
    path.join(result.artifacts_dir, "report.json"),
    `${JSON.stringify(incident, null, 2)}\n`
  );

  await fs.writeFile(
    path.join(result.artifacts_dir, "repair-context.json"),
    `${JSON.stringify(createRepairContext(result, incident), null, 2)}\n`
  );

  await fs.writeFile(
    path.join(result.artifacts_dir, "step-history.json"),
    `${JSON.stringify(result.steps, null, 2)}\n`
  );

  await fs.writeFile(
    path.join(result.artifacts_dir, "console.json"),
    `${JSON.stringify(result.console, null, 2)}\n`
  );

  await fs.writeFile(
    path.join(result.artifacts_dir, "network.json"),
    `${JSON.stringify(result.network, null, 2)}\n`
  );

  if (result.dom_snapshot_content) {
    await fs.writeFile(path.join(result.artifacts_dir, "dom.html"), result.dom_snapshot_content);
  }

  await fs.writeFile(path.join(result.artifacts_dir, "report.md"), markdownReport(result, incident));
}

/**
 * @param {import("./types.js").RunResult} result
 * @param {any} incident
 */
function createRunManifest(result, incident) {
  return {
    schema_version: "horus.run.v1",
    id: result.run_id,
    status: result.passed ? "passed" : "failed",
    project: result.project,
    environment: result.environment,
    journey: {
      name: result.journey.name,
      source_path: result.journey.source_path ?? null,
      base_url: result.journey.base_url
    },
    artifacts: {
      dir: result.artifacts_dir,
      report_json: path.join(result.artifacts_dir, "report.json"),
      repair_context_json: path.join(result.artifacts_dir, "repair-context.json"),
      report_md: path.join(result.artifacts_dir, "report.md"),
      step_history_json: path.join(result.artifacts_dir, "step-history.json"),
      console_json: path.join(result.artifacts_dir, "console.json"),
      network_json: path.join(result.artifacts_dir, "network.json"),
      dom_snapshot: result.dom_snapshot ?? null
    },
    summary: {
      passed: result.passed,
      final_url: result.final_url,
      failed_step: incident.step_failed,
      failure_type: incident.failure_type,
      severity: incident.severity,
      confidence: incident.confidence
    },
    counts: {
      steps: result.steps.length,
      console_errors: incident.browser_signal.console_errors.length,
      network_failures: incident.browser_signal.network_failures.length
    },
    repro: result.repro,
    correlation: result.correlation,
    cloud: incident.cloud ?? null,
    created_at: result.steps[0]?.started_at ?? new Date().toISOString(),
    finished_at: result.steps.at(-1)?.finished_at ?? new Date().toISOString()
  };
}

/**
 * @param {import("./types.js").RunResult} result
 * @param {any} incident
 */
function createRepairContext(result, incident) {
  return {
    schema_version: "horus.repair_context.v1",
    generated_at: new Date().toISOString(),
    run: {
      id: result.run_id,
      passed: result.passed,
      final_url: result.final_url,
      artifacts_dir: result.artifacts_dir,
      project: result.project,
      environment: result.environment
    },
    journey: {
      name: result.journey.name,
      source_path: result.journey.source_path ?? null,
      base_url: result.journey.base_url,
      steps: result.journey.steps
    },
    failure: {
      step: incident.step_failed,
      type: incident.failure_type,
      severity: incident.severity,
      confidence: incident.confidence,
      root_cause_hypothesis: incident.root_cause_hypothesis,
      recommended_action: incident.recommended_action
    },
    evidence: {
      browser: incident.browser_signal,
      backend: incident.backend_signal,
      step_history: result.steps,
      console: result.console,
      network: result.network
    },
    repro: incident.repro,
    correlation: incident.correlation,
    cloud: incident.cloud ?? null,
    routing: incident.routing,
    repair: incident.repair
  };
}

/**
 * @param {import("./types.js").RunResult} result
 * @param {any} incident
 */
function markdownReport(result, incident) {
  return `# Horus ${result.passed ? "Run" : "Incident"} Report

- Incident ID: ${incident.incident_id}
- Journey: ${incident.journey}
- Status: ${result.passed ? "passed" : "failed"}
- Failed Step: ${incident.step_failed ?? "none"}
- Failure Type: ${incident.failure_type}
- Severity: ${incident.severity}
- Confidence: ${incident.confidence}
- Final URL: ${incident.browser_signal.url}

## Root Cause Hypothesis

${incident.root_cause_hypothesis}

## Recommended Action

${incident.recommended_action}

## Browser Evidence

- Screenshot: ${incident.browser_signal.screenshot ?? "none"}
- DOM snapshot: ${incident.browser_signal.dom_snapshot ?? "none"}
- Console errors: ${incident.browser_signal.console_errors.length}
- Network failures: ${incident.browser_signal.network_failures.length}

## Step History

${result.steps.map(formatStep).join("\n")}
`;
}

/**
 * @param {import("./types.js").StepRecord} step
 */
function formatStep(step) {
  const base = `- ${step.status.toUpperCase()} [${step.index}] ${step.label} (${step.duration_ms}ms)`;
  if (!step.agent_actions || step.agent_actions.length === 0) return base;

  return `${base}\n${step.agent_actions.map((action) => `  - agent action: ${action}`).join("\n")}`;
}
