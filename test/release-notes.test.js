// The name and the sentences of a release in CHANGELOG.md, and the description
// of the release pull request, as the Release workflow reads and writes them
// (tools/release-notes.mjs).

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { MODEL, buildRequest, describeRelease, firstParagraph, originalDescription, readAnswer, readRelease, writeRelease } from '../tools/release-notes.mjs';

const COMPARE = 'https://github.com/xiidoz/netnou/compare';
const COMMIT = 'https://github.com/xiidoz/netnou/commit';
const ISSUES = 'https://github.com/xiidoz/netnou/issues';

// As release-please writes it into the release pull request.
const CHANGELOG = `# Changelog

All notable changes to Netnou, newest first.

## [0.29.0](${COMPARE}/v0.28.0...v0.29.0) (2026-11-18)


### Features

* **page:** a start without a connection shows what was open, as the page held it ([#371](${ISSUES}/371)) ([13a54f0](${COMMIT}/13a54f0)), closes [#362](${ISSUES}/362)


### Bug Fixes

* **page:** offline, the note gives the time of the data and known delays stay grey ([#368](${ISSUES}/368)) ([bdccb47](${COMMIT}/bdccb47)), closes [#361](${ISSUES}/361)

## [0.28.0](${COMPARE}/v0.27.3...v0.28.0) (2026-11-16)


### Features

* **timetable:** a bus the feed gives as a tram or U-Bahn is a bus ([#359](${ISSUES}/359)) ([7022a3d](${COMMIT}/7022a3d)), closes [#358](${ISSUES}/358)
`;

// The same, with the day taken off the heading of 0.29.0.
const UNDATED = CHANGELOG.replace(" (2026-11-18)", "");

const TEXT = 'Riders keep what they had open when the connection drops.\nKnown delays stay, in grey.';

test('a section without a name has none, and lists its pull requests, not the issues they close', () => {
  const release = readRelease(CHANGELOG, '0.29.0');
  assert.equal(release.name, '');
  assert.equal(release.text, '');
  assert.equal(release.date, '2026-11-18');
  assert.deepEqual(release.pulls, [371, 368]);
  // as it is published: without the day
  assert.equal(release.section.split('\n')[0], `## [0.29.0](${COMPARE}/v0.28.0...v0.29.0)`);
  assert.ok(release.section.endsWith('closes [#361](https://github.com/xiidoz/netnou/issues/361)'));
  assert.ok(!release.section.includes('0.28.0)'), 'the section ends before the next one');
  assert.deepEqual(readRelease(CHANGELOG, '0.28.0').pulls, [359]);
  assert.equal(readRelease(CHANGELOG, '0.27.0'), null);
});

test('a name goes behind the heading and the sentences under it, and are read back', () => {
  const named = writeRelease(CHANGELOG, '0.29.0', { name: 'The Offline Release', text: TEXT });
  const lines = named.split('\n');
  const heading = lines.findIndex(line => line.startsWith('## [0.29.0]'));
  assert.equal(lines[heading], `## [0.29.0](${COMPARE}/v0.28.0...v0.29.0) – The Offline Release`);
  assert.deepEqual(lines.slice(heading + 1, heading + 7), [
    '',
    'Riders keep what they had open when the connection drops.',
    'Known delays stay, in grey.',
    '',
    '',
    '### Features',
  ]);

  const release = readRelease(named, '0.29.0');
  assert.equal(release.name, 'The Offline Release');
  assert.equal(release.text, TEXT);
  assert.equal(release.date, '');
  assert.deepEqual(release.pulls, [371, 368]);
  assert.ok(release.section.startsWith(`## [0.29.0](${COMPARE}/v0.28.0...v0.29.0) – The Offline Release\n\n${TEXT}\n\n\n### Features`));
  // nothing else moves
  assert.equal(named.replace(' – The Offline Release', '').replace(`${TEXT}\n\n`, ''), UNDATED);
  assert.deepEqual(readRelease(named, '0.28.0'), readRelease(CHANGELOG, '0.28.0'));
});

test('a new name takes the place of the old one, and no name still takes the day off', () => {
  const named = writeRelease(CHANGELOG, '0.29.0', { name: 'The Offline Release', text: TEXT });
  const renamed = writeRelease(named, '0.29.0', { name: '  The   Tunnel Release ', text: 'One sentence.' });
  assert.deepEqual(
    { name: readRelease(renamed, '0.29.0').name, text: readRelease(renamed, '0.29.0').text },
    { name: 'The Tunnel Release', text: 'One sentence.' },
  );
  assert.equal(renamed.split('\n').filter(line => line.startsWith('## [0.29.0]')).length, 1);
  assert.equal(writeRelease(named, '0.29.0', {}), UNDATED);
  assert.equal(writeRelease(CHANGELOG, '0.29.0', { name: '', text: '' }), UNDATED);
  assert.equal(writeRelease(UNDATED, '0.29.0', {}), UNDATED);
  // only the release written loses its day
  assert.equal(readRelease(UNDATED, '0.28.0').date, '2026-11-16');
  assert.throws(() => writeRelease(CHANGELOG, '0.27.0', { name: 'X' }), /no section for 0\.27\.0/);
});

test('the sentences of a later release are not those of an older one', () => {
  const named = writeRelease(CHANGELOG, '0.28.0', { name: 'The Kinds Release', text: 'Buses are buses.' });
  assert.equal(readRelease(named, '0.29.0').text, '');
  assert.equal(readRelease(named, '0.29.0').name, '');
  assert.equal(readRelease(named, '0.28.0').text, 'Buses are buses.');
  assert.ok(named.endsWith('closes [#358](https://github.com/xiidoz/netnou/issues/358)\n'));
});

// As release-please writes the description of its pull request.
const FOOTER = 'This PR was generated with [Release Please](https://github.com/googleapis/release-please). See [documentation](https://github.com/googleapis/release-please#release-please).';
const DESCRIPTION = `:robot: I have created a release *beep* *boop*
---


${CHANGELOG.slice(CHANGELOG.indexOf('## [0.29.0]'), CHANGELOG.indexOf('## [0.28.0]')).trim()}

---
${FOOTER}`;

// What release-please takes from a merged release pull request: the version,
// and the notes it publishes the release with (PullRequestBody.parse, in its
// src/util/pull-request-body.ts).
function publishedFrom(description) {
  const lines = description.trim().replace(/\r\n/g, '\n').split('\n');
  const first = lines.indexOf('---');
  let last = lines.lastIndexOf('---');
  if (last === first) last = lines.length - 1;
  const notes = lines.slice(first + 1, last).join('\n').trim();
  return { version: /^#{2,} \[?(?<version>\d+\.\d+\.\d+[^\]]*)\]?/.exec(notes)?.groups.version, notes };
}

test('the description of the release pull request shows the release as it is published', () => {
  const release = readRelease(writeRelease(CHANGELOG, '0.29.0', { name: 'The Offline Release', text: TEXT }), '0.29.0');
  const described = describeRelease(DESCRIPTION, '0.29.0', release);
  assert.ok(described.startsWith('Merging this pull request publishes the release **v0.29.0 – The Offline Release**, with these notes:\n---\n\n\n## [0.29.0]('));
  assert.ok(!described.includes('2026-11-18'));
  // release-please still finds the version in it, and publishes the section of the changelog
  assert.deepEqual(publishedFrom(DESCRIPTION), { version: '0.29.0', notes: readRelease(CHANGELOG, '0.29.0').section.replace(')\n', ') (2026-11-18)\n') });
  assert.deepEqual(publishedFrom(described), { version: '0.29.0', notes: release.section });
  // below the notes: release-please's line, where to change the name, and release-please's description
  const footer = described.slice(described.lastIndexOf('\n---\n') + 5);
  assert.ok(footer.startsWith(`${FOOTER}\n\nThe name and the sentences come from the section of this release in the pull request's \`CHANGELOG.md\``));
  assert.match(footer, /\n<!-- release-please's own description, put back before each run of the Release workflow: [A-Za-z0-9+/=]+ -->$/);
  assert.equal(originalDescription(described), DESCRIPTION);
  assert.equal(originalDescription(DESCRIPTION), DESCRIPTION);
  // described again: the same, also from what it shows
  assert.equal(describeRelease(described, '0.29.0', release), described);
  // a later name is described from release-please's description, not from the one shown before
  const renamed = describeRelease(described, '0.29.0', { name: 'The Tunnel Release', section: release.section });
  assert.ok(renamed.startsWith('Merging this pull request publishes the release **v0.29.0 – The Tunnel Release**'));
  assert.equal(originalDescription(renamed), DESCRIPTION);
});

test('a release without a name is described by its version, and what is not release-please\'s is left as it is', () => {
  const release = readRelease(CHANGELOG, '0.29.0');
  const described = describeRelease(DESCRIPTION, '0.29.0', release);
  assert.ok(described.startsWith('Merging this pull request publishes the release **v0.29.0**, with these notes:\n'));
  assert.deepEqual(publishedFrom(described), { version: '0.29.0', notes: release.section });
  assert.equal(describeRelease('Written by hand.', '0.29.0', release), 'Written by hand.');
  assert.equal(describeRelease('', '0.29.0', release), '');
  // GitHub takes no longer description
  const long = { name: '', section: `## [0.29.0](${COMPARE}/v0.28.0...v0.29.0)\n\n${'* a change\n'.repeat(6000)}` };
  assert.equal(describeRelease(DESCRIPTION, '0.29.0', long), DESCRIPTION);
});

test('the first paragraph of a description is what it is about', () => {
  assert.equal(firstParagraph('Riders on a train lose the connection.\nThe page forgot.\n\n**Kept:**\n- this'), 'Riders on a train lose the connection.\nThe page forgot.');
  assert.equal(firstParagraph('<!--\nWhat does this change?\n-->\r\n\r\nOne line.\r\n\r\nTwo.'), 'One line.');
  assert.equal(firstParagraph(''), '');
  // a paragraph that leads into a list keeps it, and nothing after it
  assert.equal(firstParagraph('Two things were not right (#361):\n\n- **The note.** It claimed more.\n- **The delays.** They went.\n\n**The note and the delays:**\n- this'), 'Two things were not right (#361):\n\n- **The note.** It claimed more.\n- **The delays.** They went.');
  assert.equal(firstParagraph('It ends in a colon:'), 'It ends in a colon:');
});

test('the request gives Claude the list, what its pull requests are about, and the name it had', () => {
  const { section } = readRelease(CHANGELOG, '0.29.0');
  const request = buildRequest({
    version: '0.29.0',
    section,
    pulls: [{ number: 371, about: 'Riders on a train lose the connection for minutes at a time.' }, { number: 368, about: '' }],
    previous: { name: 'The Offline Release', text: 'Known delays stay.' },
  });
  assert.equal(request.model, MODEL);
  assert.equal(request.fallbacks, 'default');
  assert.equal(request.output_config.format.type, 'json_schema');
  assert.deepEqual(request.output_config.format.schema.required, ['name', 'text']);
  assert.equal(request.output_config.format.schema.additionalProperties, false);
  assert.equal(request.messages.length, 1);
  const asked = request.messages[0].content;
  assert.ok(asked.startsWith('Version 0.29.0.'));
  assert.ok(asked.includes(section));
  assert.ok(asked.includes('#371: Riders on a train lose the connection'));
  assert.ok(!asked.includes('#368:'), 'a pull request without a description is left out');
  assert.ok(asked.includes('was called "The Offline Release", with these sentences:\n\nKnown delays stay.'));
  assert.match(request.system, /"The … Release"/);

  const first = buildRequest({ version: '0.29.0', section }).messages[0].content;
  assert.ok(!first.includes('pull requests are about'));
  assert.ok(!first.includes('was called'));
});

test('an answer is taken only whole and in shape', () => {
  const response = (json, stop = 'end_turn') => ({ type: 'message', stop_reason: stop, content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: json }] });
  assert.deepEqual(
    readAnswer(response('{"name": " The  Offline Release", "text": "Riders keep what they had open.\\nKnown delays stay grey."}')),
    { name: 'The Offline Release', text: 'Riders keep what they had open. Known delays stay grey.' },
  );
  assert.throws(() => readAnswer(response('{"name": "The Offline Release", "text": "Rid', 'max_tokens')), /stopped with "max_tokens"/);
  assert.throws(() => readAnswer({ type: 'message', stop_reason: 'refusal', content: [] }), /stopped with "refusal"/);
  assert.throws(() => readAnswer({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }), /authentication_error/);
  assert.throws(() => readAnswer(response('The Offline Release')), /not JSON/);
  assert.throws(() => readAnswer(response('{"name": "", "text": "Something."}')), /name does not fit/);
  assert.throws(() => readAnswer(response(JSON.stringify({ name: 'The Offline Release', text: 'x'.repeat(601) }))), /sentences do not fit/);
});

test('the script reads and writes CHANGELOG.md as the workflow calls it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'netnou-release-notes-'));
  try {
    const file = path.join(dir, 'CHANGELOG.md');
    fs.writeFileSync(file, CHANGELOG);
    const script = path.join(import.meta.dirname, '..', 'tools', 'release-notes.mjs');
    execFileSync(process.execPath, [script, 'write', file, '0.29.0'], { input: JSON.stringify({ name: 'The Offline Release', text: TEXT }) });
    const read = JSON.parse(execFileSync(process.execPath, [script, 'read', file, '0.29.0'], { encoding: 'utf8' }));
    assert.equal(read.name, 'The Offline Release');
    assert.equal(read.text, TEXT);
    assert.equal(read.date, '');
    // the description exactly, without a line break added: the workflow compares it
    const described = execFileSync(process.execPath, [script, 'describe', file, '0.29.0'], { input: DESCRIPTION, encoding: 'utf8' });
    assert.equal(described, describeRelease(DESCRIPTION, '0.29.0', read));
    assert.equal(execFileSync(process.execPath, [script, 'original'], { input: described, encoding: 'utf8' }), DESCRIPTION);
    assert.equal(execFileSync(process.execPath, [script, 'original'], { input: DESCRIPTION, encoding: 'utf8' }), DESCRIPTION);
    assert.equal(execFileSync(process.execPath, [script, 'excerpt'], { input: 'First.\n\nSecond.', encoding: 'utf8' }), 'First.\n');
    assert.throws(() => execFileSync(process.execPath, [script, 'read', file, '0.1.0'], { stdio: 'pipe' }));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
