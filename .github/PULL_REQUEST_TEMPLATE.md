<!--
What does this change, and why? Link the issue if there is one.

The title of the pull request and every commit follow Conventional Commits,
with a scope: for example "fix(page): keep the panel heading in view" or
"feat(api): add platform to departures". See "Commit messages" in
CONTRIBUTING.md.

If the change shows in the page, add pictures of it: on a wide screen and on a
phone, and of how it looked before where that makes the difference clear.
-->

## Checklist

- [ ] `npm test` and `npm run lint` pass
- [ ] Title and commit messages follow Conventional Commits and name a scope; a breaking change is marked with `!`
- [ ] Pictures of the change are in the description if it shows in the page
- [ ] No new runtime dependency (`package.json` has no `dependencies`)
- [ ] Documentation updated if a setting or an API response changed
- [ ] `DATASET_VERSION` / `NETWORKS_VERSION` bumped if the format of a cache file changed
- [ ] New text shown in the page added to every locale file in `public/locales/`
