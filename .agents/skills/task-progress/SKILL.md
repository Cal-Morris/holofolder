---
name: task-progress
description: Keep Holo Folder GitHub issues, dependency checklists and project status accurate during implementation, review, deployment and full feature completion.
---

# Task progress and completion

Use when starting an issue, opening/updating a PR, encountering a blocker, merging, verifying a deployment or completing a feature block. Keep GitHub as the durable source of progress; chat status alone is insufficient. Reconcile current evidence rather than marking every linked issue Done because a PR merged.

## Read before updating

Read the current issue body/comments, native sub-issues and blocked-by dependencies, linked PR heads/checks/reviews, and the project's actual fields/options. Preserve collaborator edits, priority, workstream and release phase. Current home: `Cal-Morris/holofolder`, [Holo Folder project](https://github.com/users/Cal-Morris/projects/1), project ID `PVT_kwHOADCnX84Bq0Us` (verify before reuse).

Use available GitHub/project tools, or authenticated GitHub CLI if the connector cannot update project fields. If an injected `GITHUB_TOKEN`/`GH_TOKEN` lacks Projects access, the existing saved CLI login can be used with `env -u GITHUB_TOKEN -u GH_TOKEN gh ...`; do not print credentials or change unrelated authentication. If no authorized credential has access, report that precise blocker and continue work that does not depend on it.

## Status transitions

Discover field and option IDs each time, never assume a new label exists. The project currently has Todo, Ready, In Progress, In Review, Blocked and Done.

| Evidence | Project Status and issue action |
| --- | --- |
| Work planned, dependencies incomplete | Todo; leave issue open |
| Direct blockers satisfied and scoped work can start | Ready; leave issue open |
| Actual research/implementation started | In Progress; record scope and next concrete step |
| Reviewable PR opened, checks/reviews outstanding | In Review; link PR and exact head/evidence |
| Cannot progress because of a concrete external prerequisite | Blocked; record cause, affected scope and next action; retain completed work |
| PR merged, deployment or required docs/marketing pending | In Progress with explicit **Merged, deployment pending** or **Publication pending** in the issue; never Done |
| All acceptance criteria and delivery requirements verified | Done, close issue and update its parent's matching checklist |

Do not mark every downstream issue Ready automatically. Re-read native blockers and any additional acceptance gate. Do not close an epic until all required children and release slices are complete. Multiple PRs for one issue remain linked; completing one slice does not complete the issue.

## Evidence and update cadence

- On starting, mark the issue In Progress and add a concise scope/next-step update. At meaningful milestones update the issue with linked PRs, what is complete, verification, blockers/pending channels and next action. Avoid a comment per tool call or repeating unchanged status. Label AI-generated issue progress notes as bot updates.
- Use `Related: #N` for partial implementation PRs. Use an automatic closing keyword only when that PR really completes the issue's acceptance and delivery gates; otherwise close explicitly after verification. A premature auto-close must be reopened with an explanation and corrected project status.
- Check acceptance items only with evidence. Match the literal current checkbox text and preserve the rest of the body; re-read before writing. Avoid blindly replacing whole issue bodies from an old snapshot. Preserve native dependency/sub-issue links and update the relevant parent checkbox when the child is truly done.
- Use [release-and-deploy](../release-and-deploy/SKILL.md) for checks, exact-head reviews, merge and deployed-main verification. Use [feature-api-docs](../feature-api-docs/SKILL.md) for every feature's API/help/generated docs, [release-posts-and-changelog](../release-posts-and-changelog/SKILL.md) and [framer-feature-updates](../framer-feature-updates/SKILL.md) for each shipped user-facing block. An internal contract-only issue may complete with a concrete API/marketing-not-applicable explanation and a linked owning rollout issue; never publish a fictional user feature.
- Record deployment evidence (merged main SHA, deployment result, migration application when relevant), focused verification and live API/help URLs. Record Framer version, feature-page/post/changelog URLs for user-facing blocks. Local tests, preview deployment, merged code and live product verification are distinct facts.
- Keep backup/recovery prerequisites visible for schema/data work. Confirm the verified backup requirement before migrations and refresh it when live data has changed. Never attach dumps, tokens or private inventory/certificates to issues.

## Complete and reconcile

Before closing, confirm all required children/criteria, supported API/docs, audit/recovery and migration gates, deployment/enabled state and required marketing publication. Post a short completion record with evidence or update the existing progress record. Close the issue, set its project item Done and check the matching parent task; then re-read issue state, project Status and parent checkbox to verify agreement. If one mutation fails, report the inconsistency and finish the remaining authorized updates rather than claiming success.

For pending work, retain open issues and a specific next step. If waiting on PR checks/reviews, use the host's PR watcher and end the turn as instructed; do not create polling loops. A merged PR with a still-building production deployment remains pending, even when the PR watcher has ended. Follow through on production verification before reporting full delivery.
