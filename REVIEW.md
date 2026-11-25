# Review instructions

What matters in this repository. The review format, and what no review
reports, are in the prompt of langmail/factory's `review.yml`.

## What Important means here

Reserve Important for findings that would break behavior for an MCP
client or an address book: incorrect logic, wrong CardDAV URLs or hrefs,
contacts written to or deleted from the wrong address book or card, vCard
fields lost or garbled on a round trip, and tool names, inputs, or outputs
that change without a breaking-change commit.

## Do not report

- The generated README tool docs, which `npm run docs:check` checks in CI

## Always check

- A tool's description still matches what its handler does
- A new tool in `src/tools/` has a `*.test.ts` next to it
- An update keeps the vCard properties it doesn't change (`src/tools/vcard.ts`)
