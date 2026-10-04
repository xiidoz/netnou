# Security policy

## Supported versions

Security fixes go into the latest release and the `main` branch. Older
releases are not maintained.

## Reporting a vulnerability

Please do not open a public issue for a security problem. Report it privately
through GitHub's private vulnerability reporting:

<https://github.com/xiidoz/netnou/security/advisories/new>

Describe what you found, how to reproduce it and what an attacker could do
with it. The report is visible only to the maintainers.

You can expect an acknowledgement, an assessment, and, if the report is
confirmed, a fix and a published advisory that credits you unless you prefer
otherwise. Netnou is maintained by volunteers, so no response times are
promised.

## Scope

In scope:

- the HTTP server and its handling of static files and API requests
  (`server/index.js`),
- the readers for data fetched from other servers: zip and CSV
  (`server/lib/zip.js`, `csv.js`, `importer.js`), Protocol Buffers
  (`pb.js`) and OpenStreetMap PBF (`osmpbf.js`),
- the page and its Content-Security-Policy,
- the container image and the files that build it.

Out of scope:

- wrong timetable, delay or map data (see
  [CONTRIBUTING.md](CONTRIBUTING.md#reporting-bugs)),
- the feed, extract and tile servers of other parties,
- an instance's own configuration: the attribution settings are inserted
  into the page as HTML by design, and the API has no rate limiting of its
  own (see [docs/deployment.md](docs/deployment.md#running-a-public-instance)).
