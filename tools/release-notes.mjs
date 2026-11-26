// The name of a release and the few sentences under it, in CHANGELOG.md (see
// "Releases" in CONTRIBUTING.md). They stand in the section of the version:
//
//   ## [0.29.0](https://github.com/…/compare/v0.28.0...v0.29.0) – The Offline Release
//
//   A few sentences on what the release brings.
//
//
//   ### Features
//
// release-please writes the section without them, and with the day behind the
// link of the heading ("(2026-11-20)"), which is taken off: GitHub shows when a
// release was published, and git when the changelog changed. The Release
// workflow (.github/workflows/release.yml) has Claude propose the name and the
// sentences in the release pull request, shows them in its description, and
// puts them on the GitHub release once it is made. It reads and writes them
// with this script:
//
//   node tools/release-notes.mjs read <CHANGELOG.md> <version>
//     prints {name, text, date, section, pulls, earlier, repeats} as JSON: the
//     name and the sentences ("" where there are none), the day in the
//     heading ("" where there is none), the whole section as it is published
//     (its heading without the day), the numbers of the pull requests it
//     lists, the {version, name, text} of the named releases before it, newest
//     first, and the name of the one its own name repeats ("" where none)
//   node tools/release-notes.mjs write <CHANGELOG.md> <version>   < {name, text}
//     puts the name and the sentences into the section, in place of any there,
//     and takes the day off its heading
//   node tools/release-notes.mjs describe <CHANGELOG.md> <version>   < description
//     prints the description of the release pull request that shows the
//     release as it will be published: its title, and its section as its notes
//   node tools/release-notes.mjs original   < description
//     prints the description release-please wrote, which "describe" keeps in
//     its own; a description release-please wrote is printed as it is
//   node tools/release-notes.mjs excerpt   < description
//     prints what a pull request's description says about it: all of it up to
//     its pictures, how to merge it or its checklist, without pictures
//   node tools/release-notes.mjs request   < {version, section, pulls, previous, earlier}
//     prints the request to the Claude API that asks for a name and sentences:
//     pulls is [{number, about}], previous the {name, text} the release had
//     before its last changes, if any, earlier the releases before it (read)
//   node tools/release-notes.mjs answer [<CHANGELOG.md> <version>]   < the API's response
//     prints the {name, text} it holds, or fails saying why there is none;
//     given the changelog, also where the name repeats that of an earlier release

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// The heading of a version: the version with its link, the day release-please
// writes behind it, and the name.
const HEADING = /^(##?# \[(\d+\.\d+\.\d+[^\]]*)\]\([^)]*\))(?: \((\d{4}-\d{2}-\d{2})\))?(?: – (.*))?$/;
// Between the name and the list.
const NAME_SEPARATOR = ' – ';

// Where the section of a version begins and ends, as line numbers: its heading,
// and the first line of the next section (or the end).
function findSection(lines, version) {
  const start = lines.findIndex(line => HEADING.exec(line)?.[2] === version);
  if (start < 0) return null;
  let end = lines.findIndex((line, i) => i > start && HEADING.test(line));
  if (end < 0) end = lines.length;
  return { start, end };
}

// The lines of the sentences: from the heading to the first heading below it
// (release-please's "### Features" and the like).
function textEnd(lines, { start, end }) {
  for (let i = start + 1; i < end; i++) if (lines[i].startsWith('#')) return i;
  return end;
}

export function readRelease(changelog, version) {
  const lines = changelog.split('\n');
  const where = findSection(lines, version);
  if (!where) return null;
  const [, link, , date = '', named = ''] = HEADING.exec(lines[where.start]);
  const name = named.trim();
  const text = lines.slice(where.start + 1, textEnd(lines, where)).join('\n').trim();
  const heading = link + (name ? NAME_SEPARATOR + name : '');
  const section = [heading, ...lines.slice(where.start + 1, where.end)].join('\n').trim();
  // "* **page:** what it does ([#371](…)) ([13a54f0](…)), closes [#362](…)":
  // the first number of a line is its pull request, any later one an issue.
  const pulls = [];
  for (const line of lines.slice(where.start, where.end)) {
    const number = /^\* .*?\(\[#(\d+)\]/.exec(line)?.[1];
    if (number && !pulls.includes(Number(number))) pulls.push(Number(number));
  }
  const earlier = earlierReleases(lines, where);
  return { name, text, date, section, pulls, earlier, repeats: repeated(name, earlier)?.name ?? '' };
}

// How many of the named releases before a version Claude is shown, newest first.
const EARLIER = 10;

// The named releases below a section in the changelog, which are older: {version, name, text}.
function earlierReleases(lines, where) {
  const earlier = [];
  for (let i = where.end; i < lines.length && earlier.length < EARLIER; i++) {
    const [, , version, , named = ''] = HEADING.exec(lines[i]) ?? [];
    if (!version || !named.trim()) continue;
    const end = lines.findIndex((line, j) => j > i && HEADING.test(line));
    const text = lines.slice(i + 1, textEnd(lines, { start: i, end: end < 0 ? lines.length : end })).join('\n').trim();
    earlier.push({ version, name: named.trim(), text });
  }
  return earlier;
}

// The words of a name that say what the release is about, each without a
// plural "s": "The European Languages Release" says "european" and "language".
const wordsOf = (name) => new Set(name.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((word) => word && !['the', 'release', 'a', 'an', 'and', 'of'].includes(word)).map((word) => (word.length > 3 ? word.replace(/s$/, '') : word)));

// The earlier release whose name a name repeats: all its words are words of
// that name ("The Language Release" after "The European Languages Release"),
// which says nothing new. Null where it repeats none.
export function repeated(name, earlier = []) {
  if (!name) return null;
  const words = wordsOf(name);
  return earlier.find((release) => {
    const before = wordsOf(release.name);
    return [...words].every((word) => before.has(word));
  }) ?? null;
}

export function writeRelease(changelog, version, { name = '', text = '' }) {
  const lines = changelog.split('\n');
  const where = findSection(lines, version);
  if (!where) throw new Error(`CHANGELOG.md has no section for ${version}`);
  name = name.replace(/\s+/g, ' ').trim();
  text = text.trim();
  // (without the day release-please wrote)
  const heading = HEADING.exec(lines[where.start])[1] + (name ? NAME_SEPARATOR + name : '');
  // release-please leaves two empty lines between the heading and the list.
  const between = text ? ['', ...text.split('\n'), '', ''] : ['', ''];
  return [
    ...lines.slice(0, where.start),
    heading,
    ...between,
    ...lines.slice(textEnd(lines, where)),
  ].join('\n');
}

// The description of the release pull request. release-please writes
//
//   :robot: I have created a release *beep* *boop*
//   ---
//
//
//   ## [0.30.0](…) (2026-11-21)
//   …
//
//   ---
//   This PR was generated with [Release Please](…). …
//
// and, once the pull request is merged, publishes the release with what
// stands between the two lines "---" as its notes. It writes the pull request
// anew whenever its description is not exactly the one it would write. So the
// description shown in its place keeps release-please's at its end, and the
// Release workflow puts that back before it runs release-please.
const DELIMITER = '---';
const KEPT = /\n<!-- release-please's own description[^:\n]*: ([A-Za-z0-9+/=]*) -->\s*$/;
// The longest description GitHub takes.
const MAX_DESCRIPTION = 65536;

// The description as release-please wrote it.
export function originalDescription(description) {
  const kept = KEPT.exec(description)?.[1];
  return kept === undefined ? description : Buffer.from(kept, 'base64').toString('utf8');
}

// The description that shows the release as it will be published: its title,
// and its section of the changelog as its notes. Left as release-please wrote
// it where that has not the form above, or where it would grow too long.
export function describeRelease(description, version, { name, section }) {
  const original = originalDescription(description);
  const lines = original.replace(/\r\n/g, '\n').trim().split('\n');
  const first = lines.indexOf(DELIMITER);
  const last = lines.lastIndexOf(DELIMITER);
  if (first < 0 || last === first) return original;
  const title = `v${version}${name ? NAME_SEPARATOR + name : ''}`;
  const described = [
    `Merging this pull request publishes the release **${title}**, with these notes:`,
    DELIMITER,
    '',
    '',
    section,
    '',
    DELIMITER,
    lines.slice(last + 1).join('\n').trim(),
    '',
    'The name and the sentences come from the section of this release in the pull request\'s `CHANGELOG.md`: change them there, not here. The Release workflow writes this description anew from it after every push to `main`, or when it is started by hand.',
    '',
    `<!-- release-please's own description, put back before each run of the Release workflow: ${Buffer.from(original, 'utf8').toString('base64')} -->`,
  ].join('\n');
  return described.length > MAX_DESCRIPTION ? original : described;
}

// The headings below which a pull request's description is no longer about
// what changes: its pictures, how to merge it, its checklist.
const AFTER_ABOUT = /^#{1,6}\s+(pictures?|merging|checklist)\s*$/i;

// What a pull request's description says about it: what was wrong or missing,
// and what is different now. That is all of it up to its pictures, how to
// merge it or its checklist, whichever comes first (a heading in a block of
// code does not count), without comments and pictures; a table that held only
// pictures goes with them.
export function aboutPart(description) {
  const lines = description.replace(/<!--[\s\S]*?-->/g, '').replace(/\r\n/g, '\n').split('\n');
  const about = [];
  let fence = '';
  for (const line of lines) {
    const marker = line.match(/^\s*(`{3,}|~{3,})/)?.[1] ?? '';
    if (fence) {
      if (marker.startsWith(fence)) fence = '';
    } else if (marker) {
      fence = marker;
    } else if (AFTER_ABOUT.test(line)) {
      break;
    }
    about.push(line);
  }
  const text = about.join('\n')
    .replace(/\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/<img\b[^>]*>/gi, '');
  return text.split(/\n\s*\n/)
    // the rows of a table that are empty now, but not its head
    .map(block => block.split('\n').filter((line, i) => i === 0 || !/^\s*\|[\s|]*$/.test(line)))
    // a table left with no rows under its head held only pictures
    .filter(lines => lines.join('').trim() && !(lines.length < 3 && lines.every(line => /^\s*\|/.test(line))))
    .map(lines => lines.join('\n'))
    .join('\n\n')
    .trim();
}

export const MODEL = 'claude-opus-5-5';

// What Claude is asked to write, and how. The answer is checked against the
// schema by the API and by answer() below.
const SYSTEM = `You name a release of Netnou and write the few sentences that stand above its list of changes, in its changelog and on its release page on GitHub.

Netnou is an open-source web page that shows buses and trains where they are right now, with their delays and the next departures at every stop, worked out from timetable and real-time data. Riders use it mostly on a phone, on the way or on board; operators run it for a region with Docker or Node.js.

The name has the form "The … Release", with one to three plain words for what the release is mostly about, as a rider or an operator would say it: "The Offline Release", for example. No version number, no pun, no emoji.

The sentences: one to three, together at most 60 words, in plain English. Begin with what most of the release is about, and say what riders (or operators) can now do or what now works better for them, in the present tense. Speak of riders and operators, not "you" or "we". Say only what the list and the descriptions of its pull requests say. No praise words ("exciting", "seamless", "powerful"), no numbers of issues or pull requests, no names of files, functions or settings unless the change is a setting.

The name is one no earlier release has had, and not one that says what an earlier name says with a word changed or left out: after "The European Languages Release", "The Language Release" says nothing new. Name what is new in this release.

If the release had a name before its last changes were added and that name still fits, keep it exactly, and keep what still holds of its sentences; but not a name that repeats an earlier release's.`;

const SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string', description: 'The name of the release, "The … Release"' },
    text: { type: 'string', description: 'The sentences, as one paragraph' },
  },
  required: ['name', 'text'],
  additionalProperties: false,
};

export function buildRequest({ version, section, pulls = [], previous = null, earlier = [] }) {
  const parts = [`Version ${version}. Its list of changes, as it will stand in the changelog:\n\n${section}`];
  const about = pulls.filter(pull => pull.about);
  if (about.length) {
    parts.push(`What its pull requests are about, from their descriptions (without their pictures):\n\n${about.map(pull => `<pull_request number="${pull.number}">\n${pull.about}\n</pull_request>`).join('\n\n')}`);
  }
  if (previous?.name || previous?.text) {
    parts.push(`Before its last changes were added, the release was called "${previous.name}", with these sentences:\n\n${previous.text}`);
  }
  if (earlier.length) {
    parts.push(`The releases before it, newest first, whose names this one's must not repeat:\n\n${earlier.map((release) => `${release.version}: "${release.name}"${release.text ? ` – ${release.text.replace(/\s+/g, ' ')}` : ''}`).join('\n\n')}`);
  }
  return {
    model: MODEL,
    max_tokens: 16000,
    // Should the model decline, another one answers in the same call.
    fallbacks: 'default',
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
    system: SYSTEM,
    messages: [{ role: 'user', content: parts.join('\n\n') }],
  };
}

// The name and the sentences from the API's response, or an error that says
// why there are none: also where the name repeats that of an earlier release.
export function readAnswer(response, earlier = []) {
  if (response?.type === 'error') throw new Error(`the API answered with an error: ${response.error?.type}: ${response.error?.message}`);
  if (response?.stop_reason !== 'end_turn') throw new Error(`the answer stopped with "${response?.stop_reason}"`);
  const json = response.content.filter(block => block.type === 'text').map(block => block.text).join('');
  let answer;
  try {
    answer = JSON.parse(json);
  } catch {
    throw new Error('the answer is not JSON');
  }
  const name = String(answer.name ?? '').replace(/\s+/g, ' ').trim();
  const text = String(answer.text ?? '').replace(/\s+/g, ' ').trim();
  if (!name || name.length > 60) throw new Error(`the name does not fit: "${name}"`);
  if (!text || text.length > 600) throw new Error(`the sentences do not fit (${text.length} characters)`);
  const before = repeated(name, earlier);
  if (before) throw new Error(`the name "${name}" repeats that of release ${before.version}, "${before.name}"`);
  return { name, text };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, file, version] = process.argv.slice(2);
  const stdin = () => fs.readFileSync(0, 'utf8');
  try {
    if (command === 'read') {
      const release = readRelease(fs.readFileSync(file, 'utf8'), version);
      if (!release) throw new Error(`${file} has no section for ${version}`);
      console.log(JSON.stringify(release));
    } else if (command === 'write') {
      fs.writeFileSync(file, writeRelease(fs.readFileSync(file, 'utf8'), version, JSON.parse(stdin())));
    } else if (command === 'describe') {
      const release = readRelease(fs.readFileSync(file, 'utf8'), version);
      if (!release) throw new Error(`${file} has no section for ${version}`);
      // (as it is: the workflow compares it with what it replaces)
      process.stdout.write(describeRelease(stdin(), version, release));
    } else if (command === 'original') {
      process.stdout.write(originalDescription(stdin()));
    } else if (command === 'excerpt') {
      console.log(aboutPart(stdin()));
    } else if (command === 'request') {
      console.log(JSON.stringify(buildRequest(JSON.parse(stdin()))));
    } else if (command === 'answer') {
      const earlier = file ? readRelease(fs.readFileSync(file, 'utf8'), version)?.earlier ?? [] : [];
      console.log(JSON.stringify(readAnswer(JSON.parse(stdin()), earlier)));
    } else {
      console.error('usage: node tools/release-notes.mjs read|write|describe <CHANGELOG.md> <version> | original | excerpt | request | answer [<CHANGELOG.md> <version>]');
      process.exit(2);
    }
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
