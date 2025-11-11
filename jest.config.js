module.exports = {
  testEnvironment: 'node',
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
  testMatch: [
    '**/tests/**/*.test.js',
    '**/tests/**/*.spec.js'
  ],
  coverageDirectory: 'coverage',
  coveragePathIgnorePatterns: [
    '/node_modules/',
    '/tests/fixtures/',
    '/tests/mocks/'
  ],
  collectCoverageFrom: [
    'server.js',
    'evals/**/*.js',
    '!evals/**/node_modules/**'
  ],
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 75,
      lines: 80,
      statements: 80
    }
  },
  verbose: true,
  testPathIgnorePatterns: [
    '/node_modules/',
    '/transcriptions/',
    '/prompts/'
  ]
};
