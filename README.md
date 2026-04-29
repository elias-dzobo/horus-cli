# Horus CLI

Horus is a minimal journey-based QA runner. It opens a web app with Playwright, executes a deterministic user journey, captures browser evidence, and writes a structured incident report when the journey fails.

## Install

```bash
npm install -D @nonfungibledev/horus-cli
npx playwright install chromium
```

Run the CLI with:

```bash
npx horus --help
```

Or run directly from npm without adding it to a project:

```bash
npx @nonfungibledev/horus-cli run journeys/example.yaml
```

## OpenAI Agent Mode

Add an `.env` file with:

```bash
OPENAI_API_KEY=...
```

The `agent` step uses OpenAI when `OPENAI_API_KEY` is present. By default it uses `gpt-5.4-mini`; override it with:

```bash
HORUS_OPENAI_MODEL=gpt-5.4-mini
```

Agent mode is best for user journeys that can be completed through visible browser actions, such as:

- signing in with test credentials
- navigating through menus and pages
- filling forms and multi-step forms
- submitting a flow and checking for a visible success state

In v1, the agent chooses one browser action at a time from the currently visible page. It can click and fill observed elements, then records those actions in `step-history.json`, `report.md`, and `repair-context.json`.

The browser agent currently supports these actions:

- click
- fill
- select
- check
- press
- wait
- scroll

Horus generates multiple selector candidates for observed elements, including semantic and contextual selectors such as placeholder selectors and `nav button:has-text("Archive")`. The agent should use the most specific safe selector it can, and Horus validates that browser actions resolve to a visible target before acting.

Current v1 limits:

- The agent does not read email inboxes, SMS messages, or external OTP providers.
- Magic-link and OTP sign-in flows need a test bypass, fixed test OTP, seeded session, or helper step outside the browser journey.
- Prefer explicit steps for security-sensitive auth flows or flows that must use exact selectors.
- Increase `max_steps` for longer flows like onboarding or multi-page forms.

## Run a Journey

Initialize a project:

```bash
npx horus init
```

```bash
npx horus run journeys/example.yaml
```

You can also run the self-contained static example:

```bash
npx horus run journeys/static-example.yaml
```

Or a slightly richer signup/signin flow:

```bash
npx horus run journeys/signup-signin.yaml
```

Or an OpenAI-backed intent-driven flow:

```bash
npx horus run journeys/agentic-contact.yaml
```

Run every journey in `journeys/`:

```bash
npx horus run --all
```

Check local setup:

```bash
npx horus doctor
```

Inspect local run history:

```bash
npx horus runs list
npx horus runs show <run-id>
```

Prepare a run for future cloud upload:

```bash
npx horus upload <run-id>
```

Artifacts are written to `artifacts/runs/<run-id>/`:

- `run.json`
- `report.json`
- `repair-context.json`
- `report.md`
- `console.json`
- `network.json`
- `step-history.json`
- `dom.html`
- `screenshots/`

`repair-context.json` is the v1 handoff contract for future repair agents. It bundles the journey, step history, browser evidence, repro command, correlation IDs, routing hints, and repair eligibility into one structured file.

`run.json` is the canonical local run manifest. It is the CLI version of the future cloud run object and includes project, environment, journey, artifact, summary, repro, and correlation metadata.

Network evidence is filtered by relevance. Horus prioritizes app and API failures in reports while separating third-party or static asset noise, such as font/CDN failures, from likely root causes.

## Cloud-Ready Config

Horus v1 runs locally. The config already reserves cloud dashboard fields so later versions can upload the same run artifacts without changing the journey runner:

```yaml
cloud:
  dashboard_url: https://app.horus.dev
  project_id: your-project-id
```

Project and environment metadata can also be configured:

```yaml
project:
  name: my-app
  id: optional-cloud-project-id

environment:
  name: staging
  base_url: https://staging.example.com
```

If `environment.base_url` is set, it overrides the journey `base_url` at runtime so the same journeys can run against local, staging, or production targets.

## Journey Format

```yaml
name: upload_document
base_url: http://localhost:3000

steps:
  - goto: /login
  - fill:
      selector: "[name=email]"
      value: "qa@example.com"
  - fill:
      selector: "[name=password]"
      value: "password123"
  - click: "button[type=submit]"
  - expect_url_contains: /dashboard
  - expect_text: "Extraction complete"
```

For the lowest-friction path, a journey can be goal-only:

```yaml
name: contact_flow
base_url: https://staging.example.com
goal: "Sign in and submit the contact form."
success_text: "Message sent"

inputs:
  email: "{{env.TEST_EMAIL}}"
  password: "{{env.TEST_PASSWORD}}"
```

Environment placeholders such as `{{env.TEST_EMAIL}}` are read from your shell or `.env` file at runtime.

You can also write multi-step agent goals:

```yaml
name: onboarding_flow
base_url: https://staging.example.com

steps:
  - goto: ""
  - agent:
      goal: >
        Sign in with the provided credentials, navigate to onboarding,
        complete each form step, submit the onboarding flow, and stop only
        when the success page is visible.
      inputs:
        email: "{{env.TEST_EMAIL}}"
        password: "{{env.TEST_PASSWORD}}"
        name: "QA User"
        company: "Horus Labs"
      max_steps: 30
  - expect_text: "Onboarding complete"
```

For sign-up journeys, test the sign-up outcome directly. For sign-in journeys, use stable test credentials whenever possible. If your production sign-in requires OTP or magic links, create a dedicated test path for automation rather than asking Horus v1 to retrieve codes from email or SMS.
