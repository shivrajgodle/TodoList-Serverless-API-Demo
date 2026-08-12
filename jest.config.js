/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/test/**/*.test.ts'],
  // Integration tests hit a real local DynamoDB - keep them serialized
  // (see package.json "test" script: --runInBand) and give them room to
  // breathe on a cold DynamoDB Local container.
  testTimeout: 15000
};
