# Horus CLI

Horus is a minimal journey-based QA runner. It opens a web app with Playwright, executes a deterministic user journey, captures browser evidence, and writes a structured incident report when the journey fails.

## Install

```bash
npm install -D @horus/cli
npx playwright install chromium
```

Run the CLI with:

```bash
npx horus --help
```

Or run directly from npm without adding it to a project:

```bash
npx @horus/cli run journeys/example.yaml
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

Artifacts are written to `artifacts/runs/<run-id>/`:

- `report.json`
- `repair-context.json`
- `report.md`
- `console.json`
- `network.json`
- `step-history.json`
- `dom.html`
- `screenshots/`

`repair-context.json` is the v1 handoff contract for future repair agents. It bundles the journey, step history, browser evidence, repro command, correlation IDs, routing hints, and repair eligibility into one structured file.

## Cloud-Ready Config

Horus v1 runs locally. The config already reserves cloud dashboard fields so later versions can upload the same run artifacts without changing the journey runner:

```yaml
cloud:
  dashboard_url: https://app.horus.dev
  project_id: your-project-id
```

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
  email: "{{secret.TEST_EMAIL}}"
  password: "{{secret.TEST_PASSWORD}}"
```
