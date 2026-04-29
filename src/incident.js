/**
 * @param {import("./types.js").RunResult} result
 */
export function createIncident(result) {
  if (result.passed) {
    return {
      incident_id: result.run_id,
      journey: result.journey.name,
      step_failed: null,
      failure_type: "none",
      browser_signal: {
        url: result.final_url,
        console_errors: result.console.filter((item) => item.type === "error"),
        network_failures: [],
        third_party_network_failures: [],
        ignored_network_failures: [],
        screenshot: result.steps.at(-1)?.screenshot ?? null,
        dom_snapshot: null
      },
      backend_signal: null,
      root_cause_hypothesis: "Journey completed successfully.",
      severity: "none",
      confidence: 1,
      recommended_action: "No action needed.",
      repro: result.repro,
      correlation: result.correlation,
      cloud: null,
      routing: routeIncident("none", []),
      repair: repairPolicy(result, "none")
    };
  }

  const failedNetwork = result.network.filter((item) => {
    return item.failure || (typeof item.status === "number" && item.status >= 400);
  });
  const appNetwork = failedNetwork.filter((item) => item.app_relevant && !item.ignored);
  const thirdPartyNetwork = failedNetwork.filter((item) => !item.app_relevant && !item.ignored);
  const ignoredNetwork = failedNetwork.filter((item) => item.ignored);
  const consoleErrors = result.console.filter((item) => item.type === "error");

  const failureType = classifyFailure(result, appNetwork, consoleErrors);
  const severity = appNetwork.some((item) => item.status && item.status >= 500) ? "high" : "medium";

  return {
    incident_id: result.run_id,
    journey: result.journey.name,
    step_failed: result.failed_step?.label ?? null,
    failure_type: failureType,
    browser_signal: {
      url: result.final_url,
      console_errors: consoleErrors,
      network_failures: appNetwork,
      third_party_network_failures: thirdPartyNetwork,
      ignored_network_failures: ignoredNetwork,
      screenshot: result.failed_step?.screenshot ?? null,
      dom_snapshot: result.dom_snapshot ?? null
    },
    backend_signal: inferBackendSignal(appNetwork),
    root_cause_hypothesis: buildHypothesis(result, appNetwork, consoleErrors, ignoredNetwork),
    severity,
    confidence: confidenceFor(appNetwork, consoleErrors),
    recommended_action: recommendAction(failureType, appNetwork),
    repro: result.repro,
    correlation: result.correlation,
    cloud: null,
    routing: routeIncident(failureType, appNetwork),
    repair: repairPolicy(result, failureType)
  };
}

/**
 * @param {import("./types.js").RunResult} result
 * @param {import("./types.js").NetworkSignal[]} failedNetwork
 * @param {import("./types.js").ConsoleSignal[]} consoleErrors
 */
function classifyFailure(result, failedNetwork, consoleErrors) {
  if (failedNetwork.some((item) => item.failure && item.failure.includes("ERR_CONNECTION_REFUSED"))) return "backend_unreachable";
  if (failedNetwork.some((item) => item.status && item.status >= 500)) return "api_error";
  if (failedNetwork.length > 0) return "network_error";
  if (result.failed_step?.label.startsWith("expect_")) return "assertion_failed";
  if (result.failed_step?.error) return "browser_step_error";
  if (consoleErrors.length > 0) return "browser_console_error";
  return "browser_step_error";
}

/**
 * @param {import("./types.js").NetworkSignal[]} failedNetwork
 */
function inferBackendSignal(failedNetwork) {
  const first = failedNetwork[0];
  if (!first) return null;

  return {
    endpoint: `${first.method} ${safePath(first.url)}`,
    status: first.status ?? null,
    error: first.failure ?? first.status_text ?? "Request failed"
  };
}

/**
 * @param {import("./types.js").RunResult} result
 * @param {import("./types.js").NetworkSignal[]} failedNetwork
 * @param {import("./types.js").ConsoleSignal[]} consoleErrors
 * @param {import("./types.js").NetworkSignal[]} ignoredNetwork
 */
function buildHypothesis(result, failedNetwork, consoleErrors, ignoredNetwork = []) {
  const failedStep = result.failed_step?.label ?? "unknown step";
  const firstNetwork = failedNetwork[0];

  if (firstNetwork?.failure?.includes("ERR_CONNECTION_REFUSED")) {
    return `Journey failed at "${failedStep}". The app could not connect to ${safeOrigin(firstNetwork.url)} for ${firstNetwork.method} ${safePath(firstNetwork.url)}. This usually means the backend API server is not running, is listening on a different port, or is blocked from the browser.`;
  }

  if (firstNetwork?.status && firstNetwork.status >= 500) {
    return `Journey failed at "${failedStep}". A ${firstNetwork.status} response from ${safePath(firstNetwork.url)} suggests a backend service failure.`;
  }

  if (firstNetwork) {
    return `Journey failed at "${failedStep}". A failed request to ${safePath(firstNetwork.url)} may have blocked the expected UI state.`;
  }

  if (result.failed_step?.error) {
    return `Journey failed at "${failedStep}" because the browser agent could not safely complete a page action: ${summarizeError(result.failed_step.error)}`;
  }

  if (consoleErrors.length > 0) {
    return `Journey failed at "${failedStep}" with browser console errors present. Inspect the frontend runtime error first.`;
  }

  if (ignoredNetwork.length > 0) {
    return `Journey failed at "${failedStep}" without app-relevant network failures. ${ignoredNetwork.length} third-party or static asset request(s) failed, but they were treated as non-primary evidence.`;
  }

  return `Journey failed at "${failedStep}" without obvious network or console errors. The expected UI state may not have appeared.`;
}

/**
 * @param {import("./types.js").NetworkSignal[]} failedNetwork
 * @param {import("./types.js").ConsoleSignal[]} consoleErrors
 */
function confidenceFor(failedNetwork, consoleErrors) {
  if (failedNetwork.some((item) => item.status && item.status >= 500)) return 0.82;
  if (failedNetwork.length > 0 && consoleErrors.length > 0) return 0.78;
  if (failedNetwork.length > 0) return 0.72;
  if (consoleErrors.length > 0) return 0.66;
  return 0.55;
}

/**
 * @param {string} failureType
 * @param {import("./types.js").NetworkSignal[]} failedNetwork
 */
function recommendAction(failureType, failedNetwork) {
  if (failureType === "api_error") {
    return "Inspect the failing API endpoint, server logs, and upstream dependencies for the correlated request.";
  }

  if (failureType === "backend_unreachable") {
    const first = failedNetwork[0];
    return first
      ? `Start or expose the backend API expected at ${safeOrigin(first.url)}, then rerun the journey.`
      : "Start the backend API expected by the app, then rerun the journey.";
  }

  if (failureType === "network_error") {
    return "Inspect failed requests and verify the app is calling the expected endpoint with valid data.";
  }

  if (failureType === "browser_console_error") {
    return "Inspect the frontend runtime error and related component state for the failing step.";
  }

  if (failureType === "browser_step_error") {
    return "Inspect the failing browser step, selector ambiguity, and visible page state. Prefer semantic selectors or let the browser agent choose from observed selector candidates.";
  }

  if (failedNetwork.length === 0) {
    return "Review the expected selector or text, recent UI changes, and whether the journey definition still matches the app.";
  }

  return "Inspect the captured browser evidence and rerun the journey after the suspected issue is fixed.";
}

/**
 * @param {string} message
 */
function summarizeError(message) {
  return message.split("\n").map((line) => line.trim()).filter(Boolean).slice(0, 3).join(" ");
}

/**
 * @param {string} rawUrl
 */
function safePath(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return `${url.pathname}${url.search}`;
  } catch {
    return rawUrl;
  }
}

/**
 * @param {string} rawUrl
 */
function safeOrigin(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return url.origin;
  } catch {
    return rawUrl;
  }
}

/**
 * @param {string} failureType
 * @param {import("./types.js").NetworkSignal[]} failedNetwork
 */
function routeIncident(failureType, failedNetwork) {
  if (failureType === "api_error" || failureType === "backend_unreachable") {
    return {
      suspected_layer: "backend",
      suggested_owner: null,
      candidate_services: inferServices(failedNetwork),
      candidate_files: []
    };
  }

  if (failureType === "network_error") {
    return {
      suspected_layer: "fullstack",
      suggested_owner: null,
      candidate_services: inferServices(failedNetwork),
      candidate_files: []
    };
  }

  if (failureType === "browser_console_error" || failureType === "assertion_failed" || failureType === "browser_step_error") {
    return {
      suspected_layer: "frontend",
      suggested_owner: null,
      candidate_services: [],
      candidate_files: []
    };
  }

  return {
    suspected_layer: "unknown",
    suggested_owner: null,
    candidate_services: [],
    candidate_files: []
  };
}

/**
 * @param {import("./types.js").RunResult} result
 * @param {string} failureType
 */
function repairPolicy(result, failureType) {
  if (result.passed) {
    return {
      eligible: false,
      mode: "none",
      reason: "Journey passed."
    };
  }

  if (!result.journey.source_path) {
    return {
      eligible: false,
      mode: "diagnose_only",
      reason: "No journey file path is available for reproduction."
    };
  }

  return {
    eligible: failureType !== "none",
    mode: "draft_pr",
    reason: "Incident has a reproducible journey and structured browser evidence."
  };
}

/**
 * @param {import("./types.js").NetworkSignal[]} failedNetwork
 */
function inferServices(failedNetwork) {
  return Array.from(new Set(failedNetwork.map((item) => {
    try {
      return new URL(item.url).host;
    } catch {
      return null;
    }
  }).filter(Boolean)));
}
