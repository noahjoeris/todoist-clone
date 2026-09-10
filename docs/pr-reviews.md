# Feature PR reviews

Codex implements features and addresses feedback from any AI agent or human reviewer.
The user requests reviews and merges PRs. No automatic review bot, reviewer API key,
or AI status check is configured.

## Open a feature PR

1. Develop the feature on its own branch and run the repository's verification commands.
2. Commit, push, and open a PR to `main`, unless the user explicitly deferred those actions.
3. Provide the PR link and CI status. Hand back to the user to request reviews.

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
