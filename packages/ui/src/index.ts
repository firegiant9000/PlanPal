/**
 * @planpal/ui — shared UI contracts + theme.
 *
 * Phase 0 deliberately ships *contracts*, not rendered components. Mobile
 * (React Native) and web (DOM) render with different primitives, so a single
 * cross-platform component layer is a Phase 3 decision (e.g. react-native-web).
 * Until then, both apps implement these prop shapes against the shared `theme`,
 * which keeps them consistent without forcing a renderer choice now.
 */

export * from './theme';
export * from './contracts';
