# 04 — Roles Catalog

Nine standard roles cover the work surface of most projects. A small project may only need three or four; a larger one tends to grow into all nine. Treat this list as a menu, not a contract.

Each entry lists a suggested name, the position it plays on the team, when to add it, and the typical tool set.

## Orchestrator

- **Suggested name:** Melody, Atlas, Pilot — pick something short and memorable.
- **Position:** Senior Full-Stack Engineer / Tech Lead.
- **Role:** Investigate, plan, delegate, review.
- **Domain:** The whole project. Never edits code directly.
- **Tools:** Read, Glob, Grep, Bash (read-only), Task, WebFetch, WebSearch.
- **When to add:** Always. This is the agent the user talks to.

See [02-orchestrator.md](./02-orchestrator.md).

## Web Supervisor

- **Suggested name:** Harmony, Pixel, Rune.
- **Position:** Frontend / Edge Runtime.
- **Role:** Build and maintain the user-facing application.
- **Domain:** The web package — components, pages, styling, client-side state.
- **Tools:** Read, Write, Edit, Glob, Grep, Bash, LSP.
- **When to add:** Project has a frontend.

Example domains: a Next.js app on Cloudflare Pages, a Vite + React SPA, a server-rendered SvelteKit site, a React Native mobile app.

## Backend Supervisor

- **Suggested name:** Nico, Forge, Atlas (if the orchestrator is named otherwise).
- **Position:** Backend / Services / Automation.
- **Role:** Server-side logic, data pipelines, external integrations.
- **Domain:** The backend package — handlers, services, integration adapters.
- **Tools:** Read, Write, Edit, Glob, Grep, Bash, LSP.
- **When to add:** Project has a server, a worker, a CLI pipeline, or a long-running job.

Example domains: a Node API server, a Python ETL pipeline, a Playwright-based scraper, a serverless function set, a CLI tool.

This role can be split (e.g. `api-supervisor` and `pipeline-supervisor`) when those domains diverge enough that one person could not own both.

## Discovery Supervisor

- **Suggested name:** Columbus, Sherpa, Compass.
- **Position:** Research / Data Engineering.
- **Role:** Bridge external research and implementation. Finds new sources of data, evaluates third-party services, drafts integration plans.
- **Domain:** Configuration files for external sources, integration prototypes, research notes.
- **Tools:** Read, Write, Edit, Glob, Grep, Bash, WebFetch, WebSearch.
- **When to add:** Project relies on a catalog of external sources or third-party APIs that grows over time.

Example domains: store catalogs in a retail aggregator, data sources in a price comparison engine, model providers in an AI gateway, content publishers in an RSS reader.

## Test Supervisor

- **Suggested name:** Bricky, Bastion, Vault.
- **Position:** QA Engineer.
- **Role:** Write tests, run tests, gate merges on green builds.
- **Domain:** The test suite across all packages plus build verification.
- **Tools:** Read, Write, Edit, Glob, Grep, Bash, LSP.
- **When to add:** The project has more than a hundred lines of code. Even small projects benefit from a dedicated test role because tests and product code have different rhythms.

## Infra Supervisor

- **Suggested name:** Turbo, Conduit, Cog.
- **Position:** DevOps / Infrastructure.
- **Role:** CI/CD, deployment, container orchestration, secret management.
- **Domain:** `.github/workflows/`, Dockerfiles, Kubernetes manifests, deployment configs, IaC.
- **Tools:** Read, Write, Edit, Glob, Grep, Bash.
- **When to add:** Project has a real deployment target (not just `git push` to a dev server).

Example coverage: GitHub Actions pipelines, Cloudflare Pages config, Vercel project setup, Kubernetes manifests, Terraform stacks.

## UX Tester

- **Suggested name:** Granny, Pebbles, Civilian.
- **Position:** UX Tester / User Advocate.
- **Role:** Use the deployed product like an ordinary user would. File beads for confusing flows, unreadable text, broken interactions.
- **Domain:** The deployed product — does not edit code.
- **Tools:** Read, Glob, Grep, Bash, WebFetch, WebSearch.
- **When to add:** The project has a UI used by people who don't read the code.

Pair the UX tester with a persona — "your grandmother who just wants to find a discount," "a busy parent who has thirty seconds to read this page." The persona is the test rig; whatever it can't do or understand is a bug.

## Scout

- **Suggested name:** Scooby, Sniffer, Mapper.
- **Position:** Codebase Analyst.
- **Role:** Find files, map structure, report `file:line` references.
- **Domain:** The whole repo, read-only.
- **Tools:** Read, Glob, Grep, LSP.
- **When to add:** The repo is large enough that the orchestrator burns context searching for things. Below ten thousand lines, the orchestrator can usually do its own exploration.

Use a cheaper model for this role (`haiku`-class). Its output is short and structural, not creative.

## Code Reviewer

- **Suggested name:** Nitpick, Audit, Lens.
- **Position:** Senior Code Reviewer.
- **Role:** Quality gate. Reads diffs, runs tests, returns PASS or FAIL with a list of issues.
- **Domain:** Whatever changes are in front of it, read-only plus shell access for builds.
- **Tools:** Read, Glob, Grep, Bash.
- **When to add:** The project has multiple supervisors that produce diffs. The reviewer's job is to be the consistent quality bar across all of them.

Use a cheaper model here too — review work is structured, and a smaller model with a strict persona reads diffs effectively.

## A note on which to skip

For a small project — say, a one-person side project under five thousand lines — you can ship with just orchestrator + one implementation supervisor + test supervisor. Add the others as the surface grows.

Order of growth:

1. Orchestrator + one implementation supervisor (web or backend, whichever dominates).
2. Add test supervisor when you have more than a handful of tests.
3. Add the other implementation supervisor (web or backend) when the second surface appears.
4. Add infra supervisor when you have a real deployment pipeline.
5. Add discovery supervisor when you start collecting external sources/integrations.
6. Add UX tester when you have real users.
7. Add scout when codebase exploration starts to dominate the orchestrator's context.
8. Add code reviewer when supervisor output volume makes manual review the bottleneck.

Next: [05-beads-workflow.md](./05-beads-workflow.md) covers how tasks flow through the team.
