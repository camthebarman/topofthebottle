# ADR 0003: Pin TypeScript 5.9

Status: accepted

The native TypeScript 7 compiler exists, but Next.js 16.3's build-time type checking and several
tooling plugins still load the `typescript` JS API. We pin `typescript@5.9.3` workspace-wide and
revisit when Next.js documents TS 7 support. `strict` is on everywhere; `@tz/domain` also enables `noUncheckedIndexedAccess`.
