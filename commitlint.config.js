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
  // Dependabot begins the subject of an update of several packages at once
  // with a capital ("Bump the minor-and-patch group with 3 updates"), its
  // other subjects in lower case, and its settings name only the prefix.
  // Just that wording is let through.
  ignores: [(message) => /^\w+\(deps(-dev)?\): Bump the \S+ group /.test(message)],
};
