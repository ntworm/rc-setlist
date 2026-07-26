import fs from 'node:fs/promises';
import type { Plugin } from 'esbuild';

const brokenBuffer = /(^[ \t]*)b = new Buffer\(sizeOfType\(binpackTypename\)\);/m;
const fixedBuffer = /(^[ \t]*)var b = new Buffer\(sizeOfType\(binpackTypename\)\);/m;
const brokenPower = /^twoToThe32 = Math\.pow\(2, 32\);$/m;
const fixedPower = /^var twoToThe32 = Math\.pow\(2, 32\);$/m;

export function patchBinpackSource(source: string): string {
  let output = source;

  if (brokenBuffer.test(output)) {
    output = output.replace(
      brokenBuffer,
      '$1var b = new Buffer(sizeOfType(binpackTypename));',
    );
  } else if (!fixedBuffer.test(output)) {
    throw new Error('Unsupported binpack source shape: buffer declaration not found.');
  }

  if (brokenPower.test(output)) {
    output = output.replace(
      brokenPower,
      'var twoToThe32 = Math.pow(2, 32);',
    );
  } else if (!fixedPower.test(output)) {
    throw new Error('Unsupported binpack source shape: twoToThe32 declaration not found.');
  }

  return output;
}

export function strictBinpackPlugin(): Plugin {
  return {
    name: 'strict-binpack',
    setup(build) {
      build.onLoad(
        { filter: /[\\/]node_modules[\\/]binpack[\\/]index\.js$/ },
        async (args) => ({
          contents: patchBinpackSource(await fs.readFile(args.path, 'utf8')),
          loader: 'js',
        }),
      );
    },
  };
}
