# Horus Product Vision

## Product Identity

Horus is an automated testing and engineering team for QA.

It uses browser agents, log-monitoring agents, incident intelligence, and external code agents to test real user flows, document broken experiences, coordinate repairs, run quality gates, and prepare fixes for engineering teams to review.

The long-term vision is not just automated testing. Horus should become the QA and repair orchestration layer for modern software teams, especially teams already using AI coding agents.

## Core Problem

Many teams do not have the time, coverage, or dedicated QA staff to fully test their product flows. As a result, someone has to manually click through core flows before releases, or users discover broken experiences in production.

This problem is becoming sharper as teams increasingly use code agents to build and modify systems quickly. Faster code generation creates more need for an automated layer that can exercise the product like a user, catch regressions, and produce enough context for repairs.

## Target Customers

Horus is built first for:

- small to mid-sized engineering teams without dedicated QA
- solo founders and indie hackers
- teams without dedicated security engineers
- AI-native teams using Codex, Claude Code, and other coding agents

The product should be lightweight enough for a solo builder, but structured enough for a growing team.

## First Wow Workflow

A team pushes updates to staging. Once the push completes, Horus automatically starts a QA run.

Browser agents move through the product's critical user flows, capturing screenshots, visible page state, console errors, network failures, and reproducible steps. If flows are broken, Horus produces a report the team can understand.

When there is enough context, Horus dispatches code agents such as Codex or Claude Code to investigate and repair the issue in development. The repair agent runs linting and quality checks, then opens a PR with the proposed fix.

The engineering team reviews the PR and decides whether to merge.

## Product Principle

Horus should not reinvent coding agents.

Horus should coordinate the existing agentic engineering stack:

- browser agents test the product like users
- log agents watch runtime and server failures
- incident intelligence turns evidence into structured context
- repair orchestration delegates fixes to code agents
- quality gates verify fixes before PRs or deployments
- reports explain what failed, what changed, and what risk remains

## Autonomy Model

In the first version, Horus is instruction-driven. Teams define journeys or goals, and Horus runs those flows.

Over time, Horus should become discovery-driven. It should inspect the codebase, routes, documentation, existing tests, product specs, and other signals to infer the application's important user flows. It can then generate and maintain a journey map automatically.

Default autonomy:

- Horus runs tests automatically.
- Horus creates incident reports automatically.
- Horus opens GitHub issues automatically.
- Horus dispatches repair agents when failure context is strong enough.
- Horus drafts repair PRs automatically.
- Humans inspect, approve, and merge PRs.

The default human-in-the-loop checkpoint is merge approval.

Longer term, teams may opt into higher autonomy:

- auto-merge low-risk fixes
- auto-deploy after quality gates pass
- auto-rollback on detected regressions
- continuous journey discovery and maintenance
- self-updating test coverage as the product changes

## Unified System Model

Horus should be organized around one central object: the run.

A run records:

- which project and environment were tested
- which journeys or flows were attempted
- what browser agents did
- what failed
- screenshots and DOM evidence
- console and network signals
- backend/log signals
- root-cause hypotheses
- repair eligibility
- repair attempts
- quality gate results
- final reports

System flow:

```txt
          Codebase / Docs / Config
                  |
                  v
        Flow Discovery / Journey Map
                  |
                  v
CLI / CI ----> Run Orchestrator <---- Scheduler / Cloud
                  |
                  v
          Browser Agent Runs
                  |
                  v
    Evidence + Logs + Network + Console
                  |
                  v
          Incident Intelligence
                  |
                  v
       Reports / Issues / Repair Tasks
                  |
                  v
      Codex / Claude Code / Code Agents
                  |
                  v
       Quality Gates / PRs / Deploys
                  |
                  v
        Dashboard / GitHub / Team
```

## Product Surfaces

### CLI

The CLI is the local entry point. It lets developers initialize Horus, define journeys, run browser QA locally or in CI, and produce the same structured artifact bundle that cloud runs will use.

The v1 CLI already establishes the first version of the run object through `report.json`, `repair-context.json`, step history, screenshots, console signals, network signals, and correlation IDs.

### Cloud Dashboard

The dashboard should become the source of truth for teams.

It should answer:

- What broke?
- When did it break?
- Which flow failed?
- Is it still failing?
- Was a repair attempted?
- Is there a PR?
- Did quality gates pass?
- How stable is this product over time?

### GitHub Integration

GitHub is where Horus enters the engineering workflow.

Horus should:

- open issues from incidents
- attach screenshots and repro steps
- create repair branches and PRs
- comment with quality gate results
- mark checks as passing or failing
- link PRs back to incidents and runs

### Agent Orchestration Layer

This is the coordination layer for browser agents, log agents, diagnosis agents, repair agents, and verification agents.

Horus should create clear, bounded tasks for existing code agents rather than trying to replace them.

### Monitoring Layer

Horus should eventually run continuously from:

- local CLI commands
- CI workflows
- staging deploys
- production deploys
- schedules
- manual dashboard runs

It should also ingest runtime signals so failures are not browser-only.

## Core Objects

### Project

A project represents an application or repo.

It includes:

- environments
- repository connection
- config
- journey map
- team settings
- cloud dashboard metadata

### Run

A run is a test execution over one or more journeys.

It includes:

- journey attempts
- browser evidence
- logs and runtime signals
- incidents
- reports
- repair context
- correlation IDs

### Repair

A repair represents an attempt to fix an incident.

It includes:

- incident context
- candidate owner or layer
- delegated code-agent task
- branch
- patch summary
- quality gate results
- PR link
- residual risk

## Authentication Flows

For sign-up journeys, Horus should test that a user can complete the sign-up process without errors and reach the intended success state.

For sign-in journeys, Horus works best with stable test credentials.

For OTP and magic-link flows, Horus v1 should not attempt to read user email inboxes, SMS messages, or external identity providers. Teams should use:

- test bypasses
- fixed test OTPs
- seeded sessions
- backend/API helpers
- dedicated automation-friendly auth paths

This should be presented as a product expectation, not a hidden limitation.

## Roadmap Implications

### V1

- Local CLI
- YAML journeys
- Goal-driven agent steps
- Browser evidence collection
- Incident reports
- `repair-context.json`
- Cloud-ready config fields
- Clear documentation and onboarding

### V2

- Cloud upload
- Project dashboard
- Run and incident history
- GitHub issue creation
- Scheduled staging checks
- Better browser action support
- Basic log ingestion

### V3

- Repair orchestration
- Codex and Claude Code integration
- PR creation
- Quality gate workflows
- Flow discovery from codebase and docs
- Incident grouping and trend analysis

### Long Term

- Continuous autonomous QA
- Self-maintaining journey maps
- Coordinated browser, log, and code agents
- Optional auto-merge or auto-deploy for low-risk fixes
- Rollback and regression monitoring

## Current Product Posture

Horus v1 is the local implementation of the future run object.

The CLI is not throwaway. It is the foundation for cloud runs, repair context, dashboard incidents, and agent orchestration.

The near-term goal is to make the CLI useful immediately while preserving the artifact contract that future cloud and repair systems will consume.

## Implementation Plan: Incident Reporter Wedge

The near-term product position is:

> Horus catches broken user flows and produces repair-ready context for developers and coding agents.

This keeps the long-term autonomous QA vision intact while making the next releases useful before the full cloud, monitoring, and auto-repair suite exists.

### Phase 1: Trusted Local and CI Reports

Goal: a small team can run `horus run --all` locally or in CI and trust the output.

Build:

- Produce a clear aggregate summary after `run --all`, including passed, failed, artifact locations, and the highest-severity incidents.
- Improve `report.md` so the first screen answers what failed, why Horus thinks it failed, how to reproduce it, and which evidence matters.
- Add stable report sections for app network failures, third-party failures, ignored network noise, console errors, screenshots, DOM snapshot, and step history.
- Keep `run.json`, `report.json`, and `repair-context.json` backward-compatible as the core artifact contract.

Acceptance:

- A failed run can be understood without opening raw JSON first.
- `repair-context.json` contains enough structured context for a coding agent to start investigation.
- `npm run smoke` proves the full artifact bundle is still generated.

### Phase 2: GitHub and CI Workflow

Goal: Horus enters the team workflow immediately after PR or staging deploys.

Build:

- Add a `horus github issue <run-id>` command that creates a GitHub issue from a failed run.
- Include incident summary, repro command, artifact paths, screenshot path, repair-context path, and failure classification in the issue body.
- Support `--dry-run` so teams can inspect the issue body before giving GitHub credentials.
- Add a GitHub Actions example workflow for PR checks and staging-deploy checks.

Acceptance:

- A failed CI run leaves a clear local artifact bundle and can create a useful GitHub issue.
- Teams can copy the workflow example into a repo with minimal edits.

### Phase 3: Journey Authoring and Setup Quality

Goal: teams can write useful journeys without becoming Playwright experts.

Build:

- Improve `horus init` templates for auth, forms, dashboards, and API/backend failure examples.
- Expand `horus doctor` to validate journey directory, required env vars used by journeys, Chromium availability, configured base URL, and optional GitHub/CI settings.
- Add examples that demonstrate stable test credentials, OTP/magic-link constraints, goal-only journeys, deterministic steps, and API failure diagnosis.

Acceptance:

- A new user can initialize Horus, edit one journey, run it, and understand the result.
- Missing env vars or broken setup are reported before a confusing browser run.

### Phase 4: Stronger Browser Agent

Goal: agent-driven journeys are useful without pretending every action is safe.

Build:

- Improve selector ranking with semantic, role-based, label-based, placeholder-based, contextual, and visible-text candidates.
- Add page-state memory so the agent can explain what it has tried and avoid repeated actions.
- Strengthen goal completion evaluation so the agent stops when the desired state is already visible.
- Treat ambiguity as structured feedback: choose safely when the target is clear from context, otherwise report why Horus cannot decide.

Acceptance:

- The agent can complete common auth, navigation, and form flows on apps without test IDs.
- Ambiguous UI states produce actionable feedback rather than vague failures.

### Phase 5: App Log Ingestion

Goal: reports combine browser evidence with application/runtime evidence.

Build:

- Add `--logs <path>` for attaching existing app logs to a run.
- Add `--server-command "<command>"` for starting a local app/server during a run and capturing stdout/stderr.
- Include log excerpts in `report.md`, `report.json`, and `repair-context.json`.
- Correlate likely backend errors with browser network failures when possible.

Acceptance:

- Backend-not-running and backend-error incidents cite both browser evidence and relevant log evidence when available.
- Repair agents receive log excerpts without needing to inspect the developer's terminal.

### Phase 6: Repair-Agent Handoff

Goal: Horus delegates repairs to existing coding agents instead of replacing them.

Build:

- Add `horus repair-context <run-id>` to print the structured repair context for automation.
- Add `horus codex <run-id>` to print a focused Codex repair prompt pointing at the context file, repro command, and expected quality gates.
- Later add adapters for Codex, Claude Code, GitHub issue comments, and draft PR workflows.

Acceptance:

- A developer can run a failed journey, then hand the incident to a coding agent without manually collecting screenshots, logs, repro steps, or error summaries.
