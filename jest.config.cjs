module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.ts'],
  maxWorkers: 1,
  transform: {
    '^.+\\.ts$': require.resolve('ts-jest'),
  },
};
