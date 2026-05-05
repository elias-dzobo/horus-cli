# Horus GitHub Actions

Use Horus in CI after pull requests, staging deploys, or scheduled checks. The first goal is to produce trusted artifacts every time, then optionally create GitHub issues from failed runs.

## Pull Request Check

```yaml
name: Horus QA

on:
  pull_request:
  workflow_dispatch:

jobs:
  horus:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - run: npm ci
      - run: npx playwright install chromium --with-deps

      - name: Run Horus journeys
        run: npx horus run --all
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
          TEST_EMAIL: ${{ secrets.TEST_EMAIL }}
          TEST_PASSWORD: ${{ secrets.TEST_PASSWORD }}

      - name: Upload Horus artifacts
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: horus-runs
          path: artifacts/runs
```

## Staging Deploy Check

Set `environment.base_url` in `horus.config.yaml` or pass a staging-specific config before running Horus. Keep staging credentials in GitHub Actions secrets.

```yaml
name: Horus Staging QA

on:
  deployment_status:
  workflow_dispatch:

jobs:
  horus:
    if: github.event_name == 'workflow_dispatch' || github.event.deployment_status.state == 'success'
    runs-on: ubuntu-latest

    permissions:
      contents: read
      issues: write

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - run: npm ci
      - run: npx playwright install chromium --with-deps

      - name: Run Horus journeys
        id: horus
        continue-on-error: true
        run: npx horus run --all
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
          TEST_EMAIL: ${{ secrets.TEST_EMAIL }}
          TEST_PASSWORD: ${{ secrets.TEST_PASSWORD }}

      - name: Upload Horus artifacts
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: horus-runs
          path: artifacts/runs

      - name: Create issue manually from failed run
        if: steps.horus.outcome == 'failure'
        run: |
          RUN_ID="$(npx horus runs latest --failed)"
          npx horus github issue "$RUN_ID"
        env:
          GH_TOKEN: ${{ github.token }}
```
