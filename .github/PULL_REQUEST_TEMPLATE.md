<!--
What does this change, and why? Link the issue if there is one.

Write the title and the description for somebody who does not know the
project: name the parts of the page as anybody sees them ("the card at the
top left", not "the start card"), and use words in their plain sense. Begin
with what was wrong or missing, then say what is different now. Everything
above "## Pictures" is what the name and the notes of the release are made
from. See "The title and the description" in CONTRIBUTING.md.

The title of the pull request and every commit follow Conventional Commits,
with a scope: for example "fix(page): keep the panel heading in view" or
"feat(api): add platform to departures". See "Commit messages" in
CONTRIBUTING.md.

If the change shows in the page, add pictures of it under "## Pictures": on a
wide screen and on a phone, and of how it looked before where that makes the
difference clear.
-->

## Checklist

- [ ] `npm test` and `npm run lint` pass
- [ ] Title and commit messages follow Conventional Commits and name a scope; a breaking change is marked with `!`
- [ ] Pictures of the change are in the description if it shows in the page
- [ ] The pictures of the READMEs taken again (`npm run build:pictures`, then `npm run build:social`) if the card, the details, the search or the board look different
- [ ] No new runtime dependency (`package.json` has no `dependencies`)
- [ ] Documentation updated if a setting or an API response changed
- [ ] `DATASET_VERSION` / `NETWORKS_VERSION` bumped if the format of a cache file changed
- [ ] New text shown in the page added to every locale file in `public/locales/`
