# Changelog

## 0.1.0

Initial local-first CLI release.

- Run YAML-defined browser journeys with Playwright.
- Support explicit deterministic journey steps and OpenAI-backed agent steps.
- Capture screenshots, console signals, network failures, HAR files, and DOM snapshots on failure.
- Write human-readable and structured run reports.
- Emit `repair-context.json` as the v1 handoff contract for future repair agents.
- Reserve cloud dashboard config fields while keeping v1 local-only.
