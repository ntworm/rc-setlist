import * as esbuild from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { strictBinpackPlugin } from './scripts/build/binpack-strict.ts';
import { copyStaticTree, nodeEnvDefine } from './scripts/build/build-helpers.ts';

const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

const outputDir = path.dirname(manifest.entry);
const staticDst = path.join(outputDir, 'static');

function copyDir(src: string, dst: string): void {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      copyDir(s, d);
    } else if (entry.name.endsWith('.test.mjs')) {
      continue;
    } else {
      fs.copyFileSync(s, d);
    }
  }
}

function copyStatic(): void {
  copyStaticTree('static', staticDst);
  console.log(`copied static/* → ${staticDst}`);
}

function copyStaticWhileWatching(): void {
  try {
    copyStatic();
  } catch (err) {
    console.error('Error copying static:', err);
  }
}

const appDataPath = process.env.LOCALAPPDATA
  ? path.join(process.env.LOCALAPPDATA, 'Ableton', 'Extensions', 'ntworm.rc-setlist')
  : null;

const devSyncEnabled = process.env.ABLETON_SETLIST_DEV_SYNC === '1';

function syncToAppData() {
  if (!appDataPath || !fs.existsSync(appDataPath)) return;
  if (!devSyncEnabled) {
    console.log(`[dev-sync] Skipping AppData sync (${appDataPath}). Set ABLETON_SETLIST_DEV_SYNC=1 to enable.`);
    return;
  }
  try {
    fs.copyFileSync('manifest.json', path.join(appDataPath, 'manifest.json'));
    copyDir('dist', path.join(appDataPath, 'dist'));
    console.log(`[dev-sync] Synced built files directly to Ableton Live Extensions folder.`);
  } catch (err) {
    console.error('[dev-sync] Failed to sync to AppData:', err);
  }
}

if (watch) {
  const ctx = await esbuild.context({
    entryPoints: ['src/extension.ts'],
    outfile: manifest.entry,
    bundle: true,
    format: 'cjs',
    platform: 'node',
    sourcesContent: false,
    logLevel: 'info',
    minify: false,
    sourcemap: true,
    define: nodeEnvDefine(false),
    plugins: [strictBinpackPlugin(), {
      name: 'copy-static-on-end',
      setup(build) {
        build.onEnd(() => {
          copyStaticWhileWatching();
          syncToAppData();
        });
      }
    }]
  });
  await ctx.watch();
  console.log('esbuild is watching src/ for changes...');

  let debounceTimeout: NodeJS.Timeout | null = null;
  fs.watch('static', { recursive: true }, (eventType, filename) => {
    if (filename && !filename.endsWith('.test.mjs')) {
      if (debounceTimeout) clearTimeout(debounceTimeout);
      debounceTimeout = setTimeout(() => {
        console.log(`static change detected: ${filename}, rebuilding...`);
        copyStaticWhileWatching();
        syncToAppData();
      }, 100);
    }
  });
  console.log('node-watcher is watching static/ for changes...');
} else {
  fs.rmSync(outputDir, { recursive: true, force: true });
  await esbuild.build({
    entryPoints: ['src/extension.ts'],
    outfile: manifest.entry,
    bundle: true,
    format: 'cjs',
    platform: 'node',
    sourcesContent: false,
    logLevel: production ? 'silent' : 'info',
    minify: production,
    sourcemap: !production,
    define: nodeEnvDefine(production),
    plugins: [strictBinpackPlugin()],
  });
  copyStatic();
  syncToAppData();
}
