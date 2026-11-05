// Boundary rules verified by `npm run deps:check` (dependency-cruiser 18).
// P01 installs the gate and expects it to FAIL with the 11 errors from AUDIT
// A03/A04 (cycles + core → server|ui|...|runtime and core → SDK,
// server → ui). P03 zeros them and the gate flips to 0/0.

module.exports = {
  forbidden: [
    { name: 'no-circular', severity: 'error', from: {}, to: { circular: true } },
    {
      name: 'core-must-not-import-runtime',
      severity: 'error',
      from: { path: '^src/core/' },
      to: { path: '^src/(server|ui|integration|sync|osc|automation|commands|runtime)/' },
    },
    {
      name: 'core-must-not-import-sdk',
      severity: 'error',
      from: { path: '^src/core/' },
      to: { path: '@ableton-extensions/sdk' },
    },
    {
      name: 'server-must-not-import-ui',
      severity: 'error',
      from: { path: '^src/server/' },
      to: { path: '^src/ui/' },
    },
    {
      name: 'static-shared-must-not-import-pages',
      severity: 'error',
      from: { path: '^static/shared/' },
      to: { path: '^static/(setlist|performance|panel)/' },
    },
  ],
  options: {
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true,
    doNotFollow: { path: 'node_modules' },
    exclude: {
      path: 'test-results',
    },
  },
};
