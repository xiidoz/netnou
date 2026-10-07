// Commit messages follow Conventional Commits: versions, releases and the
// changelog are derived from them (see "Commit messages" in CONTRIBUTING.md).
// Checked by the commit-msg hook in .husky/ and by .github/workflows/commits.yml.
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Every message says what part it is about: the changelog puts that in
    // front of each line, and a line without one says less.
    'scope-empty': [2, 'never'],
    // Bodies and footers quote URLs and log lines, and Dependabot pastes release notes.
    'body-max-line-length': [0],
    'footer-max-line-length': [0],
  },
};
