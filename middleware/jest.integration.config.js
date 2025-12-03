export default {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  roots: ['<rootDir>/__tests__/integration'],
  testMatch: ['**/*.test.ts'],
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        useESM: true,
      },
    ],
  },
  // Integration tests need longer timeouts due to blockchain interactions
  testTimeout: 120000, // 2 minutes

  // Force serial execution due to shared port state and process management
  maxWorkers: 1,

  // Setup file for integration tests
  // setupFilesAfterEnv: ['<rootDir>/__tests__/setup-integration.ts'],

  // Coverage configuration
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/**/*.test.ts',
    '!src/**/__tests__/**',
  ],
  coverageThreshold: {
    global: {
      branches: 60,
      functions: 60,
      lines: 60,
      statements: 60,
    },
  },

  // Verbose output for debugging integration tests
  verbose: true,

  // Transform o1js modules
  transformIgnorePatterns: [
    'node_modules/(?!(o1js)/)',
  ],
};
