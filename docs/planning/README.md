# Planning archive

**Current plan:** the Revision 2026-09-29 section at the top of
[DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md) (milestones P0 to P4: sharing,
cross-user RLS proof, recurrence differential testing, ICS feed). The
evidence behind it is [../roadmap-review-2026-09.md](../roadmap-review-2026-09.md).

Working documents from building PlanPal, kept because the reasoning is often
more useful than the conclusion. These are historical: where one disagrees
with the code, the code is right, and where one disagrees with the 2026-09
revision, the revision is right.

- [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md) — the phase plan; the 2026-09 revision at its top is CURRENT, the month-by-month body below it is history with status tags
- [MONTH_1_PLAN.md](MONTH_1_PLAN.md) · [MONTH_3_4_PLAN.md](MONTH_3_4_PLAN.md) — milestone scoping
- [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) — the month 1-2 task breakdown
- [M3_M4_SPECS_PLAN.md](M3_M4_SPECS_PLAN.md) — the investigation behind months 3-4: hypotheses, what was probed, what the probes returned
- [M3_M4_IMPLEMENTATION_PLAN.md](M3_M4_IMPLEMENTATION_PLAN.md) — 36 tasks with TDD steps, definitions of done, and rollback notes
- [prompts/](prompts) — the briefs used to hand tasks to a coding agent
- Month 5 working docs in the parent folder: [../MONTH5.md](../MONTH5.md), [../M5_UPLOAD_UX_PLAN.md](../M5_UPLOAD_UX_PLAN.md), [../M5_CROSS_CUTTING_PLAN.md](../M5_CROSS_CUTTING_PLAN.md) — backend done; the UI items are DEFERRED until P1 to P3 are done

All of MONTH_1_PLAN, MONTH_3_4_PLAN, IMPLEMENTATION_PLAN and the two M3/M4
documents describe work that is merged. Their MVP exit gate (ten real
testers, two devs dogfooding) is SUPERSEDED by the one-user dogfood in P4.
