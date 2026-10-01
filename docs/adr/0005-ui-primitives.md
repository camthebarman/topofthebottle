# ADR 0005: Native HTML elements instead of a component library

Status: accepted

Forms are the product. Native `<select>`, `<input type=date>`, `<details>` and `confirm()` give
the best mobile behaviour (OS pickers, keyboard types), accessibility for free, and work under a
strict CSP without inline styles. We wrote small typed wrappers (`src/components/ui.tsx`) with
unique ids from `useId`, labels, hints and error association. No Radix/shadcn dependency.
Trade-off: fewer ready-made widgets (combobox search); acceptable for v1.
