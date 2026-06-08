/**
 * @planpal/types — shared contract types across mobile, web, and API.
 *
 * Foundational scalars, branded IDs, and the API envelope are hand-authored here.
 * Domain models (events / recurrence / friends) are NOT hand-written — they are
 * generated from the Phase 1 OpenAPI spec (`@planpal/api-contract`) and re-exported
 * via `./contract` to avoid drift. Run `pnpm --filter @planpal/api-contract generate`
 * to refresh `./generated/openapi.ts`.
 */

export * from './scalars';
export * from './ids';
export * from './api';
export * from './enums';
export * from './contract';
