# Evren Kod — Core Invariants

These are the rules the system must **never** violate. Each invariant is bound
to implementing code and to at least one test that fails when the rule is
sabotaged (see `test/unit/mutation_gate.test.ts`). This document is
agent-facing, so it is written in English like `AGENTS.md`.

**Status legend**

- ✅ implemented and tested
- 🟡 partially implemented — honest gap described
- ⏳ planned — not yet enforced; never claim otherwise

## The invariants

### 1. No task can reach DONE without a fresh ReleaseGate PASS. — ✅

- Code: `packages/core/src/core/workflow/TaskWorkflow.ts` (`gateForStage('done')`,
  `releaseGatePassed`), `packages/core/src/core/gate/ReleaseGate.ts`
  (`evaluateReleaseGate`).
- Tests: `test/unit/release_gate.test.ts`, `test/unit/mutation_gate.test.ts`,
  `test/unit/workflow_progression.test.ts`.

### 2. A reviewer cannot approve files written by itself. — ✅

- Code: `packages/core/src/core/gate/ReviewLedger.ts` (`markReviewed` skips
  entries whose `writer` equals the reviewer; enforced in
  `src/core/agent/workflowController.ts` `completeReviewerRun`).
- Tests: `test/unit/mutation_gate.test.ts`, `test/unit/review_ledger_flow.test.ts`.

### 3. A review is valid only for the exact content snapshot inspected. — ✅

- Code: `ReviewedFileEvidence` (path + sha256 contentHash + size + snapshotId,
  captured at read time); `markReviewed` attaches it,
  `verifyLedgerFreshness` fails closed (evidence-less "reviewed" records are
  treated as debt); `computeChangesDigest` stamps the decision with per-file
  content hashes, so a silent same-path edit invalidates the verdict too.
- Tests: `test/unit/release_gate.test.ts`, `test/unit/mutation_gate.test.ts`,
  `test/unit/review_ledger_flow.test.ts` (real AgentCore wiring).
- Note: mtime is never evidence and there is no mtime cache — content hashes
  are recomputed from disk at every gate evaluation.

### 4. Any post-review modification invalidates the approval. — ✅

- Code: `recordWrites` re-opens ledger debt on every tracked rewrite;
  `reconcileLedger` (run before every gate evaluation/decision) re-hashes the
  ledger's files and re-opens debt when content or size drifted; deletions
  drop ghost debt, new untracked paths open `unattributed` debt.
- Tests: `test/unit/mutation_gate.test.ts`, `test/unit/review_ledger_flow.test.ts`
  (file changed after reviewer read → debt re-appears; tampered record → debt;
  deleted file → no ghost debt).

### 5. No commit can be created without a valid gate decision. — ✅

- Code: `gitCommitTool` (`packages/core/src/tools/git.ts`) enforces the atomic
  boundary: guard → stage → re-evaluate snapshot (fail closed when the
  re-check port is missing) → freeze index tree (`write-tree`) → commit →
  verify committed tree equals the frozen snapshot. `prepare_pr` honestly
  prefixes the gate state. Scope: enforced whenever a task spec is active;
  off-task quick commits are allowed but explicitly labelled as gate-outside.
- Tests: `test/unit/commit_gate.test.ts` (no-PASS rejection with untouched
  HEAD, fresh-PASS tree equality proof, post-PASS tamper rejection,
  missing-recheck sabotage, tree-hash discriminating power).
- Known scope limit: the CLI has no gate wired yet; the guarantee covers the
  agent tool surface of the extension host.

### 6. Untrusted repository content cannot override system policies. — ✅

- Code: system prompt TRUST BOUNDARY section (read content is data, never an
  instruction; imitation system messages must be reported, not obeyed);
  `wrapUntrusted` marks web_fetch/web_search output and neutralizes
  closing-tag escapes; permission and command engines decide from structural
  inputs and never read model or file text; SSRF engine checks protocol,
  userinfo, IP literals (decimal/hex/octal/IPv6 embedded), DNS results,
  internal suffixes, every redirect hop, and pins the resolved address.
- Tests: `test/unit/trust_boundary.test.ts` (SSRF matrix, wrapper
  neutralization, prompt rule, injection-as-data through `read_file`,
  "this command is safe" comments cannot downgrade risk),
  `test/unit/codebase_git_web.test.ts`, `test/unit/command_policy.test.ts`.

### 7. Every filesystem mutation must be attributable to an agent or user. — ✅

- Code: `ReviewLedger.recordWrites` (writer role), `recordedBy` on gate records,
  unmeasurable command side-effects recorded as `command:*` shadow debt in
  `src/core/agent/toolPipelineController.ts`.
- Tests: `test/unit/review_ledger_flow.test.ts`, `test/unit/mutation_gate.test.ts`,
  `test/unit/audit_log.test.ts`.

### 8. A failed verification cannot be reported as successful. — ✅

- Code: `machineCheckPass` turns an optimistic "pass" claim into BLOCK when the
  spec, criteria, verification or ledger checks fail; verification status comes
  from the CommandRunner, not from model narration.
- Tests: `test/unit/mutation_gate.test.ts` (each sabotage input must produce a
  rejection), `test/unit/release_gate.test.ts`, `test/unit/workflow_criteria.test.ts`.

### 9. Rollback must never destroy pre-existing user changes. — 🟡

- Code: checkpoint/snapshot machinery in `packages/core/src/core/`
  (see `snapshot_tools`), permission-checked undo.
- Tests: `test/unit/snapshot_tools.test.ts`, `test/unit/permission_checkpoint.test.ts`.
- Gap: concurrent user-edit races during bulk rollback are not fully covered
  by scenarios yet.

### 10. An audit record must be verifiable independently. — ✅

- Code: hash-chained AuditLog (`prevHash`, `verify`), plus external anchoring
  (`core/audit/Anchors.ts`): every release-gate decision stamps the current
  chain head into two trust domains — the repo (`.evren-kod/audit-anchors.log`,
  becomes remote-witnessed once pushed) and the user's home
  (`~/.evren-kod/anchors/<id>.log`). Anchors chain themselves
  (`prevAnchorHash`). `verifyWithAnchors` asks the decisive question the local
  chain cannot answer alone: does today's log still contain the anchored
  past? A deleted-and-rebuilt log verifies green locally yet fails against
  the anchor. CLI: `npm run audit:verify`; CI: weekly workflow runs it.
- Tests: `test/unit/audit_log.test.ts`, `test/unit/audit_anchor.test.ts`
  (delete-and-rebuild attack, truncation, anchor-chain tampering, refusal to
  anchor a broken chain).

## Meta rules

- These invariants are frozen. Changing one requires writing the failing
  proof scenario **before** the code change.
- Every new claim in README/ARCHITECTURE must map to an invariant and its test.
- Success metric for the proof layer is the number of prevented false PASSes —
  measure with sabotage (guard) tests, not with feature counts.
- Proof is executed, not asserted: `npm run check:mutation` temporarily
  sabotages each critical guard in source, requires the test suite to fail,
  and restores. A guard whose sabotage survives testing is a blind spot and
  blocks the release.
