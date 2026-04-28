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
  const consoleErrors = result.console.filter((item) => item.type === "error");

  const failureType = classifyFailure(result, failedNetwork, consoleErrors);
  const severity = failedNetwork.some((item) => item.status && item.status >= 500) ? "high" : "medium";

  return {
    incident_id: result.run_id,
    journey: result.journey.name,
    step_failed: result.failed_step?.label ?? null,
    failure_type: failureType,
    browser_signal: {
      url: result.final_url,
      console_errors: consoleErrors,
      network_failures: failedNetwork,
      screenshot: result.failed_step?.screenshot ?? null,
      dom_snapshot: result.dom_snapshot ?? null
    },
    backend_signal: inferBackendSignal(failedNetwork),
    root_cause_hypothesis: buildHypothesis(result, failedNetwork, consoleErrors),
    severity,
    confidence: confidenceFor(failedNetwork, consoleErrors),
    recommended_action: recommendAction(failureType, failedNetwork),
    repro: result.repro,
    correlation: result.correlation,
    cloud: null,
    routing: routeIncident(failureType, failedNetwork),
    repair: repairPolicy(result, failureType)
  };
}

/**
 * @param {import("./types.js").RunResult} result
 * @param {import("./types.js").NetworkSignal[]} failedNetwork
 * @param {import("./types.js").ConsoleSignal[]} consoleErrors
 */
function classifyFailure(result, failedNetwork, consoleErrors) {
  if (failedNetwork.some((item) => item.status && item.status >= 500)) return "api_error";
  if (failedNetwork.length > 0) return "network_error";
  if (consoleErrors.length > 0) return "browser_console_error";
  if (result.failed_step?.label.startsWith("expect_")) return "assertion_failed";
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
 */
function buildHypothesis(result, failedNetwork, consoleErrors) {
  const failedStep = result.failed_step?.label ?? "unknown step";
  const firstNetwork = failedNetwork[0];

  if (firstNetwork?.status && firstNetwork.status >= 500) {
    return `Journey failed at "${failedStep}". A ${firstNetwork.status} response from ${safePath(firstNetwork.url)} suggests a backend service failure.`;
  }

  if (firstNetwork) {
    return `Journey failed at "${failedStep}". A failed request to ${safePath(firstNetwork.url)} may have blocked the expected UI state.`;
  }

  if (consoleErrors.length > 0) {
    return `Journey failed at "${failedStep}" with browser console errors present. Inspect the frontend runtime error first.`;
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

  if (failureType === "network_error") {
    return "Inspect failed requests and verify the app is calling the expected endpoint with valid data.";
  }

  if (failureType === "browser_console_error") {
    return "Inspect the frontend runtime error and related component state for the failing step.";
  }

  if (failedNetwork.length === 0) {
    return "Review the expected selector or text, recent UI changes, and whether the journey definition still matches the app.";
  }

  return "Inspect the captured browser evidence and rerun the journey after the suspected issue is fixed.";
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
 * @param {string} failureType
 * @param {import("./types.js").NetworkSignal[]} failedNetwork
 */
function routeIncident(failureType, failedNetwork) {
  if (failureType === "api_error") {
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
