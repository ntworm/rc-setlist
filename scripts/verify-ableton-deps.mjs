import { existsSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function fail(message) {
  console.error(`[ableton-deps] ${message}`);
  console.error('[ableton-deps] Set ABLETON_SDK_TGZ and ABLETON_CLI_TGZ to absolute local paths, then run npm run setup:ableton.');
  process.exitCode = 2;
}

const sdkArchive = process.env.ABLETON_SDK_TGZ?.trim();
const cliArchive = process.env.ABLETON_CLI_TGZ?.trim();

if (!sdkArchive || !cliArchive) {
  fail('Authorized Ableton archive paths are required for the release gate.');
} else if (![sdkArchive, cliArchive].every((archive) => path.isAbsolute(archive) && existsSync(archive))) {
  fail('Archive variables must point to existing absolute local paths.');
} else {
  try {
    require.resolve('@ableton-extensions/sdk');
    const binName = process.platform === 'win32' ? 'extensions-cli.cmd' : 'extensions-cli';
    const cliBin = path.join(process.cwd(), 'node_modules', '.bin', binName);
    if (!existsSync(cliBin)) throw new Error(`missing ${cliBin}`);
    console.log('[ableton-deps] Authorized SDK and CLI are installed locally.');
  } catch {
    fail('Authorized dependencies are not installed in node_modules.');
  }
}
