# ADR 0008: No staff attribution in variance, imports or AI

Status: accepted

POS CSV alone cannot prove over-pouring, under-pouring or theft: shared wells, unrung drinks,
recipe drift, counting error and timing all produce the same signal. Therefore:
- Staff/server/employee columns in POS files are detected and cannot be mapped or stored.
- Variance is reported per product and period as "unexplained usage", with method and confidence,
  never per person.
- Void/comp-by-hour shows time patterns only and says it cannot identify anyone.
- AI evidence excludes people, notes, Bar Book and schedules.
Revisit only with an explicit, consented, per-shift attribution design.
