# ai-review

The automated pull-request reviewer for AgentMail's repositories.

A pull request needs one approval to merge. When no reviewer is around, the engineer can ask for an automated one.

## How to use it

1. Review your own change first, ideally with a strong model. The automated reviewer only catches obvious errors.
2. Add the `ai-review` label to the pull request.
3. The `agentmail-ai-reviewer` App posts a review: an approval when it finds nothing blocking, otherwise a comment
   listing what it found.

Adding the label is your statement that you reviewed the change and accept responsibility for merging it on
automated approval alone. The review records your name, the model, and the commit it read.

## What to expect

- A push dismisses the approval. While the label stays on, the new commit is reviewed automatically.
- If the workflow fails (an API error, an answer it cannot read), it posts nothing and the PR stays unapproved.
  Re-run the workflow, or remove and re-add the label.
- It never requests changes, so it cannot block a PR that a person approved.
- Required status checks still have to pass.
- It does not run on pull requests from forks.

## Adding a repository

1. Add the repository to the `agentmail-ai-reviewer` App's installation.
2. Create the `ai-review` label.
3. Set the `OPENAI_API_KEY` and `AI_REVIEWER_PRIVATE_KEY` secrets.
4. Add `.github/workflows/ai-review.yml`:

```yaml
name: AI review

on:
  pull_request_target:
    types: [labeled, synchronize]

permissions:
  contents: read
  pull-requests: read

jobs:
  review:
    uses: agentmail-to/ai-review/.github/workflows/review.yml@main
    secrets:
      OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
      AI_REVIEWER_PRIVATE_KEY: ${{ secrets.AI_REVIEWER_PRIVATE_KEY }}
```

## Changing the reviewer

Everything is in this repository: the workflow (`.github/workflows/review.yml`, which also names the model), the
script (`review.ts`) and the prompt (`prompt.md`). Every repository is reviewed by the version on `main` here, so
a change takes effect everywhere once it merges, and a pull request elsewhere cannot change its own reviewer.

Run the tests with `node --test` (Node 24 or later).
