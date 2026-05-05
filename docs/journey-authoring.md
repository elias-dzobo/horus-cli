# Horus Journey Authoring

Horus journeys are YAML files that describe one user flow. A journey can be deterministic, agent-driven, or a mix of both.

Use deterministic steps when the flow must be exact. Use agent steps when the desired user outcome matters more than exact selectors.

## Standard Shape

Every journey must include:

- `name`: stable snake_case journey name
- `base_url`: app URL or local HTML/file path
- either `steps` or top-level `goal`

Recommended structure:

```yaml
name: checkout_flow
base_url: https://staging.example.com

inputs:
  email: "{{env.TEST_EMAIL}}"
  password: "{{env.TEST_PASSWORD}}"

steps:
  - goto: /login
  - fill:
      selector: "[name=email]"
      value: "{{env.TEST_EMAIL}}"
  - fill:
      selector: "[name=password]"
      value: "{{env.TEST_PASSWORD}}"
  - click: "button[type=submit]"
  - expect_url_contains: /dashboard
  - expect_text: "Dashboard"
```

Environment placeholders like `{{env.TEST_EMAIL}}` are read from the shell or `.env` file at runtime.

## Goal-Only Journey

Goal-only journeys are the easiest way to start. Horus opens `base_url`, asks the browser agent to complete the goal, and optionally checks `success_text`.

```yaml
name: contact_form
base_url: https://staging.example.com

goal: >
  Sign in with the provided credentials, navigate to the contact page,
  submit the contact form, and stop when the success message is visible.
success_text: "Message sent"
max_steps: 25

inputs:
  email: "{{env.TEST_EMAIL}}"
  password: "{{env.TEST_PASSWORD}}"
  name: "QA User"
  message: "Testing the contact flow with Horus."
```

Use this when:

- the flow is user-outcome oriented
- exact selectors are unknown or likely to change
- the app has visible labels, buttons, and form fields the agent can inspect

## Explicit Step Journey

Explicit steps are best for CI, auth, checkout, billing, admin actions, or any flow where repeatability matters.

Supported v1 steps:

```yaml
steps:
  - goto: /login
  - fill:
      selector: "[name=email]"
      value: "{{env.TEST_EMAIL}}"
  - click: "button[type=submit]"
  - upload:
      selector: "input[type=file]"
      file: ./fixtures/document.pdf
  - wait_for_selector: "[data-state=ready]"
  - wait_ms: 1000
  - expect_text: "Dashboard"
  - expect_url_contains: /dashboard
```

Step reference:

- `goto`: navigates relative to `base_url`, or to an absolute URL
- `fill`: fills a Playwright selector with a value
- `click`: clicks a Playwright selector
- `upload`: attaches a local file to a file input
- `wait_for_selector`: waits for a visible selector
- `wait_ms`: waits for a fixed number of milliseconds
- `expect_text`: waits for visible text
- `expect_url_contains`: waits until the current URL contains a string

## Mixed Journey

A mixed journey uses deterministic setup and assertions around an agent task.

```yaml
name: onboarding_flow
base_url: https://staging.example.com

steps:
  - goto: /login
  - fill:
      selector: "[name=email]"
      value: "{{env.TEST_EMAIL}}"
  - fill:
      selector: "[name=password]"
      value: "{{env.TEST_PASSWORD}}"
  - click: "button[type=submit]"
  - expect_text: "Dashboard"
  - agent:
      goal: >
        Navigate to onboarding, complete the profile and company steps,
        then submit the onboarding form.
      max_steps: 30
      inputs:
        name: "QA User"
        company: "Horus Labs"
  - expect_text: "Onboarding complete"
```

Use this pattern when login needs exact handling but the later product flow can be handled by the browser agent.

## Auth Guidance

For sign-up journeys, test that a user can complete sign-up and reach the expected success state.

For sign-in journeys, prefer stable test credentials:

```yaml
inputs:
  email: "{{env.TEST_EMAIL}}"
  password: "{{env.TEST_PASSWORD}}"
```

Horus v1 does not read email inboxes, SMS messages, or external OTP providers. For OTP or magic-link flows, use one of these:

- fixed test OTP
- seeded session
- test-only bypass
- backend/API helper before the browser journey
- dedicated automation-friendly auth path

## Selector Guidance

When writing explicit steps, prefer selectors in this order:

1. stable test selectors, such as `[data-testid=submit-order]`
2. semantic form selectors, such as `[name=email]`
3. accessible or visible text selectors, such as `button:has-text("Save")`
4. contextual selectors, such as `nav button:has-text("Settings")`

Avoid brittle selectors like:

```yaml
- click: "div:nth-child(3) > button"
```

Horus can test apps without test IDs, but explicit journeys become more reliable when selectors describe user intent instead of layout position.

## Common Patterns

### Dashboard Smoke Test

```yaml
name: dashboard_smoke
base_url: https://staging.example.com

steps:
  - goto: /login
  - fill:
      selector: "[name=email]"
      value: "{{env.TEST_EMAIL}}"
  - fill:
      selector: "[name=password]"
      value: "{{env.TEST_PASSWORD}}"
  - click: "button[type=submit]"
  - expect_url_contains: /dashboard
  - expect_text: "Dashboard"
```

### Form Submission

```yaml
name: contact_form
base_url: https://staging.example.com

steps:
  - goto: /contact
  - fill:
      selector: "[name=name]"
      value: "QA User"
  - fill:
      selector: "[name=message]"
      value: "Testing with Horus."
  - click: "button:has-text(\"Send\")"
  - expect_text: "Message sent"
```

### Backend/API Failure Check

```yaml
name: billing_api_check
base_url: https://staging.example.com

steps:
  - goto: /billing
  - expect_text: "Billing"
  - click: "button:has-text(\"Refresh invoices\")"
  - expect_text: "Invoices"
```

If this fails because the backend is unreachable or returns a 500, Horus separates app-relevant network failures from third-party/static asset noise in the report.

## Naming and Organization

Recommended file layout:

```txt
journeys/
  auth-login.yaml
  dashboard-smoke.yaml
  billing-flow.yaml
  onboarding-flow.yaml
```

Recommended journey names:

- `auth_login`
- `dashboard_smoke`
- `billing_flow`
- `onboarding_flow`

Run one journey:

```bash
npx horus run journeys/dashboard-smoke.yaml
```

Run all journeys:

```bash
npx horus run --all
```
