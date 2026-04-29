# Changelog

## 0.1.0

Initial local-first CLI release.

- Run YAML-defined browser journeys with Playwright.
- Support explicit deterministic journey steps and OpenAI-backed agent steps.
- Capture screenshots, console signals, network failures, HAR files, and DOM snapshots on failure.
- Write human-readable and structured run reports.
- Emit `repair-context.json` as the v1 handoff contract for future repair agents.
- Reserve cloud dashboard config fields while keeping v1 local-only.
- Provide guided `horus init` output and a commented starter journey template.
- Resolve `{{env.NAME}}` placeholders from the shell or `.env` file at runtime.
- Add `run.json` as the canonical local run manifest.
- Add project and environment metadata to local runs.
- Add `horus doctor`, `horus runs list`, `horus runs show`, and `horus upload`.
- Expand browser-agent actions beyond click/fill to select, check, press, wait, and scroll.
- Filter network evidence so app/API failures are prioritized over third-party static asset noise.
- Stop applying Horus correlation headers globally to third-party requests.
- Add richer selector candidates and safer selector validation for browser-agent actions.
- Add goal-satisfaction evaluation so the agent can stop when the requested page/state is already visible.
