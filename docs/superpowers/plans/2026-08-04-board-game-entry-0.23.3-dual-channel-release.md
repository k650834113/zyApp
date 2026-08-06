# Board Game Entry 0.23.3 Dual-Channel Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish the completed fast board-game entry feature as desktop version 0.23.3 to both test and production update channels with matching API code and PostgreSQL migration 20.

**Architecture:** Keep the existing Electron generic-update flow and the existing isolated test/production Docker stacks. Build one immutable 0.23.3 artifact set, deploy the committed source tree to test first, verify it, then deploy the same commit and artifacts to production. Deployment archives must be generated from Git `HEAD` so unrelated dirty workspace files cannot reach either server.

**Tech Stack:** PowerShell, Git, pnpm, Electron Builder, Node test runner, Docker Compose, PostgreSQL, NestJS.

## Global Constraints

- Desktop and root package versions must both be exactly `0.23.3`.
- Local SQLite schema must be version `30`; test and production PostgreSQL must migrate to version `20`.
- Test and production desktop update manifests must expose exactly `0.23.3` after deployment.
- Test deployment must finish successfully before production deployment starts.
- Production deployment must create its existing database backup before migration.
- Uncommitted and untracked workspace files must not enter deployment archives.
- The same committed source and locally verified installer hashes must be used for both channels.
- The BGG token must be deployed as a root-owned server file and must never enter Git, environment values, the installer, logs, or user-facing output.
- Public BGG images remain disabled until their written license scope is separately confirmed.

---

### Task 1: Lock Deployment Archives to Committed Source

**Files:**
- Create: `infra/scripts/create-deployment-source-archive.ps1`
- Modify: `infra/scripts/deploy-test-release.ps1`
- Modify: `infra/scripts/deploy-production.ps1`
- Test: `infra/scripts/test-release-contract.mjs`

**Interfaces:**
- Consumes: repository root, destination `.tgz` path, and current Git `HEAD`.
- Produces: a gzip-compressed tar archive containing only files tracked by the committed `HEAD` tree.

- [ ] **Step 1: Add a failing integration test** that creates a temporary Git repository with one committed file plus dirty and untracked files, invokes the archive helper, and asserts only the committed content is present.
- [ ] **Step 2: Run `corepack pnpm test:release-contract`** and confirm it fails because the helper does not exist.
- [ ] **Step 3: Implement the archive helper** with `git archive --format=tar.gz --output <archive> HEAD` and make both deployment scripts call it.
- [ ] **Step 4: Re-run `corepack pnpm test:release-contract`** and confirm the archive isolation test passes.

### Task 2: Prepare 0.23.3 Release Metadata

**Files:**
- Modify: `package.json`
- Modify: `apps/merchant-desktop/package.json`
- Modify: `apps/merchant-desktop/release-notes.md`
- Modify: `infra/scripts/verify-release-contract.mjs`
- Modify: `infra/scripts/test-release-contract.mjs`
- Create: `docs/0.23.3桌游快速录入发布验收.md`

**Interfaces:**
- Consumes: completed board-game entry implementation and schema/migration constants.
- Produces: a machine-verifiable 0.23.3 release contract and user-facing release notes.

- [ ] **Step 1: Change contract expectations to 0.23.3** and run the release-contract test to observe the expected version failures.
- [ ] **Step 2: Set both package versions to 0.23.3** and prepend release notes describing fast manual entry, optional BGG import, Chinese-field review, and matching mini-program fields.
- [ ] **Step 3: Add the 0.23.3 acceptance contract** with SQLite 30, PostgreSQL 20, and both update channels.
- [ ] **Step 4: Run release-contract, typecheck, targeted board-game/API/cloud tests, and builds; stop on any failure.**

### Task 3: Build and Verify Windows Artifacts

**Files:**
- Generated: `apps/merchant-desktop/dist-installer/桌游吧管理收银 Setup 0.23.3.exe`
- Generated: `apps/merchant-desktop/dist-installer/桌游吧管理收银 Setup 0.23.3.exe.blockmap`
- Generated: `apps/merchant-desktop/dist-installer/latest.yml`
- Generated: `apps/merchant-desktop/dist-installer/release-manifest.json`

**Interfaces:**
- Consumes: committed 0.23.3 source and release notes.
- Produces: installer, differential blockmap, update manifest, SHA-256 manifest, and rollback reference to 0.23.2.

- [ ] **Step 1: Run `infra/scripts/prepare-desktop-release.ps1`.**
- [ ] **Step 2: Independently recalculate file sizes and SHA-256 hashes** and compare them with `release-manifest.json`.
- [ ] **Step 3: Commit the 0.23.3 release-source changes** without staging unrelated user files or generated installers.

### Task 4: Deploy and Verify Test Channel

**Files:**
- Execute: `infra/scripts/deploy-test-release.ps1`

**Interfaces:**
- Consumes: committed source, production environment file, SSH credentials, and verified 0.23.3 artifacts.
- Produces: test API/worker on migration 20 and test desktop update channel 0.23.3.

- [ ] **Step 1: Record current test/production health and update versions.**
- [ ] **Step 2: Install the approved BGG token as a server-only root-owned file and run the test deployment script**, which backs up the test database, builds test services, runs migration 20, restarts test API/worker, and publishes the update files.
- [ ] **Step 3: Verify test health, migration 20, BGG availability/search/details, update manifest 0.23.3, and downloadable installer/blockmap.**

### Task 5: Deploy and Verify Production Channel

**Files:**
- Execute: `infra/scripts/deploy-production.ps1`

**Interfaces:**
- Consumes: the same committed source and 0.23.3 artifacts verified in Task 4.
- Produces: production API/worker on migration 20 and production desktop update channel 0.23.3.

- [ ] **Step 1: Run the production deployment script**, which creates a production database backup before migration, builds services, runs migration 20, restarts API/worker, and publishes the update files.
- [ ] **Step 2: Verify production health, migration 20, update manifest 0.23.3, and downloadable installer/blockmap.**
- [ ] **Step 3: Confirm the test channel remains healthy at 0.23.3** and report artifact hashes, commit, backup result, and both channel states.
