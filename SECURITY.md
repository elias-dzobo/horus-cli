# Security

## Secrets

Do not commit `.env`, API keys, npm tokens, cloud credentials, screenshots, DOM snapshots, HAR files, or generated run artifacts.

Use `.env.example` to document required environment variables without storing secret values.

## Reporting Issues

Before the public repository is configured, report security issues privately to the project maintainer.

## Release Checks

Before publishing or pushing to GitHub, run:

```bash
npm run check
npm run smoke
npm audit --omit=dev
npm --cache /tmp/horus-npm-cache run pack:dry
```
