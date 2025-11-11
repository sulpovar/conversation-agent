/**
 * Test Setup and Configuration
 * Runs before all tests
 */

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.TRANSCRIPTIONS_DIR = './tests/fixtures/transcriptions';
process.env.PROMPTS_DIR = './tests/fixtures/prompts';
process.env.CLAUDE_API_KEY = 'test-api-key';
process.env.LANGSMITH_TRACING = 'false';
process.env.RAG_ENABLED = 'false';
process.env.PORT = '0'; // Random port for testing

// Mock console methods to reduce noise in test output
const originalLog = console.log;
const originalWarn = console.warn;

global.silenceConsole = () => {
  console.log = jest.fn();
  console.warn = jest.fn();
  console.error = jest.fn();
};

global.restoreConsole = () => {
  console.log = originalLog;
  console.warn = originalWarn;
  console.error = console.error;
};

// Global test timeout
jest.setTimeout(30000);

// Cleanup after all tests
afterAll(async () => {
  // Give time for async operations to complete
  await new Promise(resolve => setTimeout(resolve, 1000));
});
