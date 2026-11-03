# Changelog

This file follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## Unreleased

### Security

- Raise Next.js to 16.4.4, better-auth to 1.7.15, Zod to 4.6.7, and happy-dom to 21.0.4 so `pnpm audit` no longer reports high or critical findings in those packages.

### Changed

- Replaced the long README with a short introduction, install steps, and a requirements table.
- Added `ARCHITECTURE.md`, `CONTRIBUTING.md`, `AGENTS.md`, and `ops/deploy.md`.
- Rewrote the pilot runbook and the go or no-go record so an operator can follow them.
