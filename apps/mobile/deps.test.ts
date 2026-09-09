import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * `^` ranges on the native modules are the root cause class behind the Metro
 * bundle failure: `react-native-screens: ^4.0.0` resolved to 4.25.2, whose Fabric
 * spec files import a `CodegenTypes` export that react-native 0.79 does not have.
 * The Expo SDK pins are what the SDK was tested with; a caret lets a later
 * release in without a commit. Keep them pinned (`~` or exact), as
 * `expo install --fix` writes them.
 *
 * Runs under `jest-expo` (D-H). `__dirname` rather than `import.meta.url`:
 * jest-expo compiles to CommonJS, where `import.meta` does not exist.
 */
const NATIVE_MODULE = /^(expo|react-native)(-.+)?$/;

function readPackageJson(): { dependencies: Record<string, string> } {
  return JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf8'));
}

describe('apps/mobile dependency ranges', () => {
  it('pins every native-module dependency without a caret range', () => {
    const { dependencies } = readPackageJson();
    const caretPinned = Object.entries(dependencies)
      .filter(([name]) => NATIVE_MODULE.test(name))
      .filter(([, range]) => range.startsWith('^'))
      .map(([name, range]) => `${name} ${range}`);

    expect(caretPinned).toEqual([]);
  });
});
