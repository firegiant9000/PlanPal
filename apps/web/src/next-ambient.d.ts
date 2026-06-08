// Committed Next.js ambient type references.
//
// Next regenerates `next-env.d.ts` on every build and re-adds a volatile
// `.next/types` reference that can't be committed (`.next/` is gitignored). To
// keep the CI `typecheck` step (which runs before `build`) resolving Next's
// ambient types deterministically, we commit these stable references here and
// gitignore the generated `next-env.d.ts`.
/// <reference types="next" />
/// <reference types="next/image-types/global" />
