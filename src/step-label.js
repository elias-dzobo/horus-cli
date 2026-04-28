/**
 * @param {import("./types.js").JourneyStep} step
 */
export function stepLabel(step) {
  if ("goto" in step) return `goto: ${step.goto}`;
  if ("click" in step) return `click: ${step.click}`;
  if ("fill" in step) return `fill: ${step.fill.selector}`;
  if ("upload" in step) return `upload: ${step.upload.selector}`;
  if ("agent" in step) return `agent: ${step.agent.goal}`;
  if ("expect_text" in step) return `expect_text: ${step.expect_text}`;
  if ("expect_url_contains" in step) return `expect_url_contains: ${step.expect_url_contains}`;
  if ("wait_for_selector" in step) return `wait_for_selector: ${step.wait_for_selector}`;
  if ("wait_ms" in step) return `wait_ms: ${step.wait_ms}`;
  return "unknown step";
}
