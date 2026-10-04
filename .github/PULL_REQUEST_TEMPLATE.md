<!--
What does this change, and why? Link the issue if there is one.

The title of the pull request and every commit follow Conventional Commits,
for example "fix: keep the panel heading in view" or "feat(api): add platform
to departures". See "Commit messages" in CONTRIBUTING.md.
-->

## Checklist

- [ ] `npm test` and `npm run lint` pass
- [ ] Title and commit messages follow Conventional Commits; a breaking change is marked with `!`
- [ ] No new runtime dependency (`package.json` has no `dependencies`)
- [ ] Documentation updated if a setting or an API response changed
- [ ] `DATASET_VERSION` / `NETWORKS_VERSION` bumped if the format of a cache file changed
- [ ] New text shown in the page added to every locale file in `public/locales/`
