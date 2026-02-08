module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/phase1-kernel-conformance.test.ts', '**/tests/phase2-conformance.test.ts', '**/tests/phase3-v5.1-conformance.test.ts', '**/tests/phase4-v5.2-conformance.test.ts', '**/tests/api-e2e/api-smoke.test.ts'],
  globalSetup: '<rootDir>/tests/global-setup.ts',
  maxWorkers: 1,
  transform: {
    '^.+\\.ts$': require.resolve('ts-jest'),
  },
};
