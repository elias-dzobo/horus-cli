import OpenAI from "openai";

const DEFAULT_MODEL = "gpt-5.4-mini";

/**
 * A compact observe -> plan -> act loop. With OPENAI_API_KEY present it uses an
 * OpenAI model as the planner; otherwise it falls back to the deterministic demo
 * planner so local examples still run.
 *
 * @param {import("playwright").Page} page
 * @param {{ goal: string, inputs?: Record<string, unknown>, max_steps?: number }} task
 */
export async function runAgentTask(page, task) {
  const maxSteps = task.max_steps ?? 12;
  const inputs = normalizeInputs(task.inputs ?? {});
  /** @type {string[]} */
  const actions = [];

  for (let index = 0; index < maxSteps; index += 1) {
    const observation = await observe(page);
    const completion = process.env.OPENAI_API_KEY
      ? await evaluateGoalWithOpenAI(task.goal, observation, actions)
      : await evaluateGoalWithRules(page, task.goal, observation);
    if (completion.satisfied) {
      actions.push(`complete: ${completion.reason}`);
      return actions;
    }

    const action = process.env.OPENAI_API_KEY
      ? await planWithOpenAI(page, task.goal, observation, inputs, actions)
      : planWithRules(task.goal, observation);

    if (action.action === "complete") {
      actions.push(`complete: ${action.reason}`);
      return actions;
    }

    if (action.action === "fail") {
      throw agentError(`Agent failed: ${action.reason}`, actions);
    }

    actions.push(formatAction(action));
    await act(page, action);
    await page.waitForTimeout(150);

    const postActionObservation = await observe(page);
    const postActionCompletion = process.env.OPENAI_API_KEY
      ? await evaluateGoalWithOpenAI(task.goal, postActionObservation, actions)
      : await evaluateGoalWithRules(page, task.goal, postActionObservation);
    if (postActionCompletion.satisfied) {
      actions.push(`complete: ${postActionCompletion.reason}`);
      return actions;
    }
  }

  throw agentError(`Agent could not complete goal within ${maxSteps} actions: ${task.goal}`, actions);
}

/**
 * @param {import("playwright").Page} page
 * @param {string} goal
 * @param {Awaited<ReturnType<typeof observe>>} observation
 */
async function evaluateGoalWithRules(page, goal, observation) {
  const normalizedGoal = goal.toLowerCase();
  if (normalizedGoal.includes("contact")) {
    const satisfied = await page.getByText("Message sent").first().isVisible().catch(() => false);
    return {
      satisfied,
      reason: satisfied ? "The contact form reports that the message was sent." : "The visible page state does not yet satisfy the goal."
    };
  }

  if (normalizedGoal.includes("archive")) {
    const text = observation.visibleText.join("\n").toLowerCase();
    const satisfied = text.includes("archive") && (text.includes("prior research") || text.includes("saved runs"));
    return {
      satisfied,
      reason: satisfied ? "The archive page is visible." : "The archive page is not visible yet."
    };
  }

  return {
    satisfied: false,
    reason: "The visible page state does not yet satisfy the goal."
  };
}

/**
 * @param {import("playwright").Page} page
 */
async function observe(page) {
  return page.evaluate(() => {
    /** @param {Element} element */
    const visible = (element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
    };

    /** @param {string} value */
    const quote = (value) => `"${CSS.escape(value)}"`;

    /** @param {string} value */
    const textQuote = (value) => `"${value.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"")}"`;

    /** @param {Element} element */
    const regionFor = (element) => {
      if (element.closest("nav")) return "nav";
      if (element.closest("header")) return "header";
      if (element.closest("main")) return "main";
      if (element.closest("form")) return "form";
      return "page";
    };

    /** @param {Element} element */
    const selectorsFor = (element) => {
      const testId = element.getAttribute("data-testid");
      const name = element.getAttribute("name");
      const id = element.getAttribute("id");
      const ariaLabel = element.getAttribute("aria-label");
      const placeholder = element.getAttribute("placeholder");
      const tag = element.tagName.toLowerCase();
      const text = element.textContent?.trim();
      const region = regionFor(element);
      const selectors = [];

      if (testId) selectors.push(`[data-testid=${quote(testId)}]`);
      if (ariaLabel) selectors.push(`${tag}[aria-label=${quote(ariaLabel)}]`);
      if (name) selectors.push(`[name=${quote(name)}]`);
      if (id) selectors.push(`#${CSS.escape(id)}`);
      if (placeholder && (tag === "input" || tag === "textarea")) selectors.push(`${tag}[placeholder=${quote(placeholder)}]`);
      if (text && (tag === "button" || tag === "a")) {
        selectors.push(`${tag}:has-text(${textQuote(text)})`);
        if (region === "nav") selectors.push(`nav ${tag}:has-text(${textQuote(text)})`);
        if (region === "header") selectors.push(`header ${tag}:has-text(${textQuote(text)})`);
      }

      selectors.push(tag);
      return Array.from(new Set(selectors));
    };

    const elements = Array.from(document.querySelectorAll("button, a, input, textarea, select"))
      .filter((element) => visible(element))
      .map((element) => {
        const selectors = selectorsFor(element);
        return {
        selector: selectors[0],
        selectors,
        region: regionFor(element),
        tag: element.tagName.toLowerCase(),
        type: element.getAttribute("type") || null,
        name: element.getAttribute("name") || null,
        ariaLabel: element.getAttribute("aria-label") || null,
        text: element.textContent?.trim() || null,
        placeholder: element.getAttribute("placeholder") || null,
        value: element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement ? element.value : null,
        checked: element instanceof HTMLInputElement && (element.type === "checkbox" || element.type === "radio") ? element.checked : null,
        options: element instanceof HTMLSelectElement
          ? Array.from(element.options).map((option) => ({ value: option.value, text: option.textContent?.trim() || option.value }))
          : null
      };
      });

    const visibleText = document.body.innerText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 40);

    return {
      url: window.location.href,
      title: document.title,
      visibleText,
      elements
    };
  });
}

/**
 * @param {import("playwright").Page} page
 * @param {string} goal
 * @param {Awaited<ReturnType<typeof observe>>} observation
 * @param {ReturnType<typeof normalizeInputs>} inputs
 * @param {string[]} history
 * @returns {Promise<AgentAction>}
 */
async function planWithOpenAI(page, goal, observation, inputs, history) {
  const client = new OpenAI();
  const model = process.env.HORUS_OPENAI_MODEL || DEFAULT_MODEL;

  const response = await client.responses.create({
    model,
    input: [
      {
        role: "system",
        content: [
          "You are a browser test planner for Horus.",
          "Choose exactly one next action to advance the user's goal.",
          "Use selector values from an element's selectors array whenever possible.",
          "Prefer semantic, contextual selectors such as nav button:has-text(\"Archive\") over broad text selectors.",
          "If a label appears in more than one place, choose the selector that matches the user's intent and page region.",
          "Fill or select fields with values from the provided inputs.",
          "Use check for checkboxes, press for keyboard keys, wait for short UI delays, and scroll when visible content must move.",
          "Return complete only when the visible page state proves the goal is done.",
          "For contact forms, do not return complete immediately after filling fields; click the send or submit button first.",
          "Return fail if the goal cannot be advanced from the current observation."
        ].join(" ")
      },
      {
        role: "user",
        content: JSON.stringify({
          goal,
          inputs,
          history,
          observation
        })
      }
    ],
    text: {
      format: {
        type: "json_schema",
        name: "horus_browser_action",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["action", "selector", "value", "reason"],
          properties: {
            action: { type: "string", enum: ["click", "fill", "select", "check", "press", "wait", "scroll", "complete", "fail"] },
            selector: { type: ["string", "null"] },
            value: { type: ["string", "null"] },
            reason: { type: "string" }
          }
        }
      }
    }
  });

  return validateAction(page, parsePlannerOutput(extractOutputText(response)), observation);
}

/**
 * @param {string} goal
 * @param {Awaited<ReturnType<typeof observe>>} observation
 * @param {string[]} history
 * @returns {Promise<{ satisfied: boolean, reason: string }>}
 */
async function evaluateGoalWithOpenAI(goal, observation, history) {
  const client = new OpenAI();
  const model = process.env.HORUS_OPENAI_MODEL || DEFAULT_MODEL;

  const response = await client.responses.create({
    model,
    input: [
      {
        role: "system",
        content: [
          "You are a browser QA goal evaluator for Horus.",
          "Decide whether the visible page state already satisfies the user's goal.",
          "Use visible text, URL, title, and observed elements as evidence.",
          "If the requested page or success state is already visible, return satisfied true.",
          "Do not require another click just because a matching nav button is still visible."
        ].join(" ")
      },
      {
        role: "user",
        content: JSON.stringify({ goal, history, observation })
      }
    ],
    text: {
      format: {
        type: "json_schema",
        name: "horus_goal_evaluation",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["satisfied", "confidence", "reason"],
          properties: {
            satisfied: { type: "boolean" },
            confidence: { type: "number" },
            reason: { type: "string" }
          }
        }
      }
    }
  });

  const parsed = parsePlannerOutput(extractOutputText(response));
  if (!parsed || typeof parsed !== "object") {
    return { satisfied: false, reason: "Goal evaluator returned an invalid result." };
  }

  const result = /** @type {{ satisfied?: unknown, confidence?: unknown, reason?: unknown }} */ (parsed);
  const confidence = typeof result.confidence === "number" ? result.confidence : 0;
  return {
    satisfied: result.satisfied === true && confidence >= 0.7,
    reason: typeof result.reason === "string" ? result.reason : "Visible page state evaluated."
  };
}

/**
 * @param {string} goal
 * @param {Awaited<ReturnType<typeof observe>>} observation
 * @returns {AgentAction}
 */
function planWithRules(goal, observation) {
  const normalizedGoal = goal.toLowerCase();
  const text = observation.visibleText.join("\n").toLowerCase();
  const wantsContact = normalizedGoal.includes("contact");

  if (wantsContact && text.includes("message sent")) {
    return { action: "complete", selector: null, value: null, reason: "The contact form reports that the message was sent." };
  }

  if (wantsContact && text.includes("contact")) {
    return { action: "fill", selector: "[name=\"contact_name\"]", value: "QA User", reason: "Fill the contact name field." };
  }

  if (text.includes("dashboard")) {
    return { action: "click", selector: "[data-testid=\"contact-nav\"]", value: null, reason: "Open the contact page from the dashboard." };
  }

  if (text.includes("sign in")) {
    return { action: "fill", selector: "[name=\"signin_email\"]", value: "qa-user@example.com", reason: "Fill the sign-in email field." };
  }

  return { action: "click", selector: "[data-testid=\"go-to-signin\"]", value: null, reason: "Switch from signup to signin." };
}

/**
 * @param {import("playwright").Page} page
 * @param {AgentAction} action
 */
async function act(page, action) {
  if (action.action === "click") {
    if (!action.selector) throw new Error("Click action requires a selector.");
    await page.locator(action.selector).click();
    return;
  }

  if (action.action === "fill") {
    if (!action.selector || action.value === null) throw new Error("Fill action requires a selector and value.");
    await page.locator(action.selector).fill(action.value);
    return;
  }

  if (action.action === "select") {
    if (!action.selector || action.value === null) throw new Error("Select action requires a selector and value.");
    await page.locator(action.selector).selectOption(action.value);
    return;
  }

  if (action.action === "check") {
    if (!action.selector) throw new Error("Check action requires a selector.");
    await page.locator(action.selector).check();
    return;
  }

  if (action.action === "press") {
    if (!action.selector || action.value === null) throw new Error("Press action requires a selector and key value.");
    await page.locator(action.selector).press(action.value);
    return;
  }

  if (action.action === "wait") {
    const duration = action.value ? Number.parseInt(action.value, 10) : 500;
    await page.waitForTimeout(Number.isFinite(duration) ? Math.min(Math.max(duration, 100), 5_000) : 500);
    return;
  }

  if (action.action === "scroll") {
    const direction = action.value === "up" ? -1 : 1;
    await page.mouse.wheel(0, direction * 700);
    return;
  }

  throw new Error(`Unsupported executable agent action: ${action.action}`);
}

/**
 * @param {import("playwright").Page} page
 * @param {unknown} raw
 * @param {Awaited<ReturnType<typeof observe>>} observation
 * @returns {Promise<AgentAction>}
 */
async function validateAction(page, raw, observation) {
  if (!raw || typeof raw !== "object") {
    throw new Error("Planner returned a non-object action.");
  }

  const action = /** @type {Partial<AgentAction>} */ (raw);
  const actionType = action.action;
  if (!["click", "fill", "select", "check", "press", "wait", "scroll", "complete", "fail"].includes(String(actionType))) {
    throw new Error(`Planner returned unsupported action: ${String(action.action)}`);
  }

  const selectorActions = ["click", "fill", "select", "check", "press"];
  if (selectorActions.includes(String(actionType)) && typeof action.selector !== "string") {
    throw new Error(`Planner returned ${action.action} without a selector.`);
  }

  const valueActions = ["fill", "select", "press"];
  if (valueActions.includes(String(actionType)) && typeof action.value !== "string") {
    throw new Error(`Planner returned ${action.action} without a string value.`);
  }

  let selector = action.selector ?? null;
  if (selectorActions.includes(String(actionType)) && selector) {
    const observedSelectors = new Set(observation.elements.flatMap((element) => [element.selector, ...(element.selectors ?? [])].filter(Boolean)));
    const candidateSelector = observedSelectors.has(selector) ? selector : selector;
    const resolvedSelector = await resolveActionSelector(page, candidateSelector, actionType, observation);
    if (!resolvedSelector) {
      throw new Error(`Planner selected a selector that could not be resolved safely: ${selector}`);
    }
    selector = resolvedSelector;
  }

  return {
    action: /** @type {"click" | "fill" | "select" | "check" | "press" | "wait" | "scroll" | "complete" | "fail"} */ (actionType),
    selector,
    value: action.value ?? null,
    reason: typeof action.reason === "string" ? action.reason : "No reason provided."
  };
}

/**
 * @param {import("playwright").Page} page
 * @param {string} selector
 * @param {unknown} actionType
 * @param {Awaited<ReturnType<typeof observe>>} observation
 */
async function resolveActionSelector(page, selector, actionType, observation) {
  const direct = await uniqueVisibleSelector(page, selector);
  if (direct) return direct;

  const refined = refinementCandidates(selector, actionType, observation);
  for (const candidate of refined) {
    const resolved = await uniqueVisibleSelector(page, candidate);
    if (resolved) return resolved;
  }

  return null;
}

/**
 * @param {import("playwright").Page} page
 * @param {string} selector
 */
async function uniqueVisibleSelector(page, selector) {
  try {
    const locator = page.locator(selector);
    const count = await locator.count();
    if (count !== 1) return null;
    if (!(await locator.first().isVisible().catch(() => false))) return null;
    return selector;
  } catch {
    return null;
  }
}

/**
 * @param {string} selector
 * @param {unknown} actionType
 * @param {Awaited<ReturnType<typeof observe>>} observation
 */
function refinementCandidates(selector, actionType, observation) {
  const candidates = [];
  const text = selector.startsWith("text=") ? selector.slice(5).trim() : null;
  if (text && actionType === "click") {
    candidates.push(`nav button:has-text("${escapeTextSelector(text)}")`);
    candidates.push(`header button:has-text("${escapeTextSelector(text)}")`);
    candidates.push(`button:has-text("${escapeTextSelector(text)}")`);
    candidates.push(`a:has-text("${escapeTextSelector(text)}")`);
  }

  for (const element of observation.elements) {
    if (element.selectors?.includes(selector)) {
      candidates.push(...element.selectors);
    }
  }

  return Array.from(new Set(candidates));
}

/**
 * @param {string} text
 */
function escapeTextSelector(text) {
  return text.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"");
}

/**
 * @param {unknown} response
 */
function extractOutputText(response) {
  if (response && typeof response === "object" && "output_text" in response && typeof response.output_text === "string") {
    return response.output_text;
  }

  throw new Error("OpenAI response did not include output_text.");
}

/**
 * @param {string} text
 */
function parsePlannerOutput(text) {
  try {
    return JSON.parse(text);
  } catch {
    const json = firstJsonObject(text);
    if (!json) throw new Error(`Planner returned invalid JSON: ${text.slice(0, 240)}`);
    return JSON.parse(json);
  }
}

/**
 * @param {string} text
 */
function firstJsonObject(text) {
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === "{") {
      if (depth === 0) start = index;
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        return text.slice(start, index + 1);
      }
    }
  }

  return null;
}

/**
 * @param {AgentAction} action
 */
function formatAction(action) {
  if (action.action === "fill") return `fill ${action.selector}: ${action.reason}`;
  if (action.action === "select") return `select ${action.selector}: ${action.reason}`;
  if (action.action === "check") return `check ${action.selector}: ${action.reason}`;
  if (action.action === "press") return `press ${action.selector} ${action.value}: ${action.reason}`;
  if (action.action === "wait") return `wait ${action.value ?? "500"}ms: ${action.reason}`;
  if (action.action === "scroll") return `scroll ${action.value ?? "down"}: ${action.reason}`;
  if (action.action === "click") return `click ${action.selector}: ${action.reason}`;
  return `${action.action}: ${action.reason}`;
}

/**
 * @param {Record<string, unknown>} inputs
 */
function normalizeInputs(inputs) {
  return {
    email: readString(inputs, "email", "qa-user@example.com"),
    password: readString(inputs, "password", "correct-horse-battery"),
    name: readString(inputs, "name", "QA User"),
    message: readString(inputs, "message", "Hello from Horus.")
  };
}

/**
 * @param {Record<string, unknown>} inputs
 * @param {string} key
 * @param {string} fallback
 */
function readString(inputs, key, fallback) {
  const value = inputs[key];
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

/**
 * @param {string} message
 * @param {string[]} actions
 */
function agentError(message, actions) {
  const error = new Error(message);
  Object.assign(error, { agent_actions: actions });
  return error;
}

/**
 * @typedef {Object} AgentAction
 * @property {"click" | "fill" | "select" | "check" | "press" | "wait" | "scroll" | "complete" | "fail"} action
 * @property {string | null} selector
 * @property {string | null} value
 * @property {string} reason
 */
