import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const outputPath = path.join(root, 'THIRD_PARTY_NOTICES.md');
const releaseVersion = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version;

function npmProductionTree() {
  const npmExecPath = process.env.npm_execpath;
  const command = npmExecPath ? process.execPath : 'npm';
  const args = npmExecPath
    ? [npmExecPath, 'ls', '--omit=dev', '--all', '--json', '--long', '--package-lock-only']
    : ['ls', '--omit=dev', '--all', '--json', '--long', '--package-lock-only'];
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    shell: !npmExecPath && process.platform === 'win32',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`npm ls failed:\n${result.stdout ?? ''}\n${result.stderr ?? ''}`);
  return JSON.parse(result.stdout);
}

function collectPackages(node, packages = new Map()) {
  for (const [name, dependency] of Object.entries(node.dependencies ?? {})) {
    if (!dependency || typeof dependency !== 'object') continue;
    if (dependency.version && dependency.path) {
      packages.set(`${name}@${dependency.version}`, {
        name,
        version: dependency.version,
        packagePath: dependency.path,
      });
    }
    collectPackages(dependency, packages);
  }
  return [...packages.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

function licenseText(packagePath) {
  const names = readdirSync(packagePath).filter((name) => /^(?:licen[cs]e|copying|notice)(?:\..*)?$/i.test(name));
  if (names.length === 0) return 'No standalone license file was included in the installed package. See the package metadata and upstream repository.';
  return names.sort().map((name) => (
    readFileSync(path.join(packagePath, name), 'utf8').replace(/\r\n?/g, '\n').trim()
  )).join('\n\n');
}

function buildNotices() {
  const packages = collectPackages(npmProductionTree());
  const interLicense = readFileSync(path.join(root, 'docs', 'fonts', 'OFL.txt'), 'utf8')
    .replace(/\r\n?/g, '\n')
    .trim();
  const sections = packages.map(({ name, version, packagePath }) => {
    const metadata = JSON.parse(readFileSync(path.join(packagePath, 'package.json'), 'utf8'));
    const license = typeof metadata.license === 'string' ? metadata.license : 'See license text';
    const source = typeof metadata.repository === 'string'
      ? metadata.repository
      : metadata.repository?.url ?? metadata.homepage ?? 'See npm package metadata';
    return `## ${name} ${version}\n\nLicense: ${license}\n\nSource: ${source}\n\n\`\`\`text\n${licenseText(packagePath)}\n\`\`\``;
  });

  const header = `# Third-party notices\n\nThis file covers third-party components bundled in Ableton RC Setlist 0.4.0. It is generated from the installed production dependency tree; run \`npm run notices\` after dependency changes.\n\n## Ableton Extensions SDK\n\nThe Ableton Extensions SDK and CLI are licensed separately by Ableton AG. Their development archives are not redistributed in this source repository. Authorized SDK runtime components may be included only inside the packaged Ableton RC Setlist application under the applicable Ableton terms.\n\n## QRCode for JavaScript\n\nCopyright (c) 2009 Kazuhiko Arase\n\nLicense: MIT\n\n\`\`\`text\nPermission is hereby granted, free of charge, to any person obtaining a copy\nof this software and associated documentation files (the "Software"), to deal\nin the Software without restriction, including without limitation the rights\nto use, copy, modify, merge, publish, distribute, sublicense, and/or sell\ncopies of the Software, and to permit persons to whom the Software is\nfurnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in\nall copies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\nIMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\nFITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\nAUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\nLIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\nOUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN\nTHE SOFTWARE.\n\`\`\``;

  const versionedHeader = header.replace('Ableton RC Setlist 0.4.0', `Ableton RC Setlist ${releaseVersion}`);
  const interSection = `## Inter 4.1\n\nCopyright 2016 The Inter Project Authors\n\nLicense: SIL Open Font License 1.1\n\nSource: https://github.com/rsms/inter/releases/tag/v4.1\n\n\`\`\`text\n${interLicense}\n\`\`\``;
  return `${versionedHeader}\n\n${interSection}\n\n${sections.join('\n\n')}\n`;
}

const generated = buildNotices();
if (process.argv.includes('--check')) {
  if (!existsSync(outputPath) || readFileSync(outputPath, 'utf8') !== generated) {
    console.error('THIRD_PARTY_NOTICES.md is missing or stale. Run npm run notices.');
    process.exit(1);
  }
  console.log('THIRD_PARTY_NOTICES.md is current.');
} else {
  writeFileSync(outputPath, generated, 'utf8');
  console.log(`Wrote ${path.relative(root, outputPath)} for ${collectPackages(npmProductionTree()).length} production packages.`);
}
