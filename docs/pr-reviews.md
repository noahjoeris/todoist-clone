# Feature PR reviews

Codex implements features and addresses feedback from any AI agent or human reviewer.
The user requests reviews and merges PRs. No automatic review bot, reviewer API key,
or AI status check is configured.

## Open a feature PR

1. Develop the feature on its own branch and run the repository's verification commands.
2. Commit, push, and open a PR to `main`, unless the user explicitly deferred those actions.
   Title the PR with the same conventional format as commit subjects (below).
3. Provide the PR link and CI status. Hand back to the user to request reviews.

## PR titles

Same rules as commit subjects. Squash-merge uses the title as the commit on `main`.

```text
type(scope): summary
```

Use `type: summary` when there is no useful scope.

Common types:

- `feat`: user-visible feature or capability
- `fix`: bug fix
- `docs`: documentation only
- `test`: tests only
- `refactor`: restructuring without behavior change
- `perf`: performance improvement
- `style`: formatting or lint-only change
- `build`: build system or dependency change
- `ci`: CI configuration change
- `chore`: maintenance that does not fit another type
- `revert`: revert a prior commit

Subject requirements:

- Keep the summary imperative and specific.
- Prefer lowercase after the colon unless a name or acronym requires casing.
- Do not end with a period.
- Keep it near 72 characters when practical.
- Match the repository's existing commit style when it is clear and compatible.

Never mention LLMs, AI, generated code, automated authorship, or tool usage.

```text
feat(tasks): add local task creation and list
docs: define manual PR review workflow
fix(client): restore platform database adapters
```

## Address feedback

When the user asks to address comments on a PR:

1. Read review summaries, inline threads, and general PR comments from all reviewers,
   whether AI agents or humans. Evaluate feedback on its merits, regardless of author.
2. Evaluate each finding against the code. Fix valid issues and add relevant regression tests.
3. Reply to each actionable finding with the fix commit or a reasoned disagreement.
   Resolve threads only after addressing them and replying; leave undecided items open.
4. Push fixes to the same PR branch, verify CI, and report remaining findings.
5. Hand back to the user for any re-review. Never trigger it automatically.

Earlier reviews do not cover new commits. Report whether implementation is complete,
feedback has been addressed, or the latest revision has actually been reviewed.
After two fix/re-review rounds with recurring findings or disagreements, summarize
unresolved decisions for the user. The user always makes the merge decision.
