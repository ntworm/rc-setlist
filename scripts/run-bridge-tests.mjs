// Runs the RC Bridge remote-script tests (bridge/tests) with whichever Python
// the machine has. Live embeds Python 3.11, so any 3.9+ interpreter is a fair
// stand-in for the routing logic under test; the Live API itself is stubbed.
import { spawnSync } from 'node:child_process';

const candidates = process.platform === 'win32' ? ['python', 'py', 'python3'] : ['python3', 'python'];
const args = ['-m', 'unittest', 'discover', '-s', 'bridge/tests', '-v'];

for (const python of candidates) {
  const probe = spawnSync(python, ['--version'], { encoding: 'utf8' });
  if (probe.error || probe.status !== 0) continue;
  const version = `${probe.stdout || probe.stderr}`.trim();
  console.log(`[bridge-tests] ${version} (${python})`);
  const result = spawnSync(python, args, { stdio: 'inherit' });
  process.exit(result.status ?? 1);
}

console.error('[bridge-tests] No Python 3 interpreter found (tried: ' + candidates.join(', ') + ').');
console.error('[bridge-tests] The RC Bridge remote script is Python; its tests need one to run.');
process.exit(1);
