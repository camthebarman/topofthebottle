# ADR 0010: POS presets are labelled unverified until checked against real files

Status: accepted

Toast presets follow Toast's published data-export field reference (ItemSelectionDetails,
ModifiersSelectionDetails). The Square preset is a draft from public descriptions; Square does not
publish an authoritative column list for its item-detail export. No real customer export from either
system was available. Every preset is shown as "(not yet verified)" in the UI with its header source, and as unverified in the docs, the generic mapper is
always available, and every import shows a preview, quarantine list and totals for the user to
reconcile against their POS report. A preset becomes "verified" only after a real file passes.
