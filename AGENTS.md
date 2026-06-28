# Agent Instructions

This is a personal project. Optimize for fast local iteration and direct production updates on `main`.

- Do implementation work in a separate git worktree on a short-lived branch when the change is more than a tiny edit.
- When the change is done and verified, merge it back into the main checkout so local `main` shows the finished files.
- Push directly to `main` and deploy to the linked Vercel project. Do not open PRs unless Cal explicitly asks.
- Keep one running production instance on `main` for now. It is fine to make direct changes to it.
- Before deploying, run the smallest relevant local checks and call out anything that was not verified.
