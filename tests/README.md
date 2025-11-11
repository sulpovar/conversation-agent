# Test Suite Documentation

Comprehensive test suite for the Interview Transcription Manager application.

## 📚 Table of Contents

- [Overview](#overview)
- [Test Structure](#test-structure)
- [Running Tests](#running-tests)
- [Test Coverage](#test-coverage)
- [Writing New Tests](#writing-new-tests)
- [Mocks and Fixtures](#mocks-and-fixtures)
- [Continuous Integration](#continuous-integration)

## Overview

This test suite provides comprehensive coverage of the application's functionality across three layers:

1. **Unit Tests**: Test individual functions and utilities in isolation
2. **Integration Tests**: Test complete workflows end-to-end
3. **API Tests**: Test HTTP endpoints with mocked dependencies

## Test Structure

```
tests/
├── setup.js                    # Global test configuration
├── fixtures/                   # Sample data for testing
│   ├── sample_transcript.txt   # Raw interview transcript
│   └── sample_formatted.md     # Formatted transcript example
├── mocks/                      # Mock implementations
│   ├── claude_client.js        # Mock Claude API client
│   └── file_system.js          # Mock file system operations
├── unit/                       # Unit tests
│   ├── utils.test.js           # Utility function tests
│   └── api-endpoints.test.js   # API endpoint tests
└── integration/                # Integration tests
    └── workflow.test.js        # End-to-end workflow tests
```

## Running Tests

### Install Dependencies

```bash
npm install
```

This will install the test dependencies:
- `jest`: Test framework
- `supertest`: HTTP assertion library
- `@types/jest`: TypeScript definitions for Jest

### Run All Tests

```bash
npm test
```

### Run Tests in Watch Mode

```bash
npm run test:watch
```

### Run Tests with Coverage

```bash
npm run test:coverage
```

This generates a coverage report in `coverage/` directory.

### Run Tests with Verbose Output

```bash
npm run test:verbose
```

### Run Specific Test File

```bash
npm test -- tests/unit/utils.test.js
```

### Run Tests Matching a Pattern

```bash
npm test -- --testNamePattern="generateArtifactName"
```

## Test Coverage

Our coverage targets:

- **Lines**: ≥80%
- **Functions**: ≥75%
- **Branches**: ≥70%
- **Statements**: ≥80%

Current coverage can be viewed by running:

```bash
npm run test:coverage
```

### Coverage Reports

After running coverage, view the HTML report:

```bash
# On Windows
start coverage/lcov-report/index.html

# On macOS
open coverage/lcov-report/index.html

# On Linux
xdg-open coverage/lcov-report/index.html
```

## Writing New Tests

### Unit Test Template

```javascript
describe('MyFunction', () => {
  it('should handle basic case', () => {
    const result = myFunction('input');
    expect(result).toBe('expected');
  });

  it('should handle edge cases', () => {
    expect(myFunction('')).toBe('default');
    expect(myFunction(null)).toThrow();
  });
});
```

### API Test Template

```javascript
const request = require('supertest');

describe('POST /api/my-endpoint', () => {
  it('should return 200 with valid input', async () => {
    const response = await request(app)
      .post('/api/my-endpoint')
      .send({ data: 'test' })
      .expect(200);

    expect(response.body.success).toBe(true);
  });

  it('should return 400 with invalid input', async () => {
    await request(app)
      .post('/api/my-endpoint')
      .send({})
      .expect(400);
  });
});
```

### Integration Test Template

```javascript
describe('Complete Workflow', () => {
  it('should complete full process from input to output', async () => {
    // Setup
    const input = prepareTestData();

    // Execute
    const result = await executeWorkflow(input);

    // Verify
    expect(result.success).toBe(true);
    expect(result.output).toMatchObject({
      field1: expect.any(String),
      field2: expect.any(Number)
    });
  });
});
```

## Mocks and Fixtures

### Using Mock Claude Client

```javascript
const { MockClaudeClient } = require('../mocks/claude_client');

describe('Claude Integration', () => {
  let mockClient;

  beforeEach(() => {
    mockClient = new MockClaudeClient();
  });

  it('should call Claude API', async () => {
    const response = await mockClient.messages({
      messages: [{ role: 'user', content: 'test' }]
    });

    expect(response.content[0].text).toBeDefined();
    expect(mockClient.getCallCount()).toBe(1);
  });
});
```

### Using Mock File System

```javascript
const { MockFileSystem } = require('../mocks/file_system');

describe('File Operations', () => {
  let mockFS;

  beforeEach(() => {
    mockFS = new MockFileSystem();
    mockFS.seed({
      'transcriptions/test.txt': 'Test content',
      'prompts/test.txt': 'Test prompt'
    });
  });

  it('should read file', async () => {
    const content = await mockFS.readFile('transcriptions/test.txt');
    expect(content).toBe('Test content');
  });
});
```

### Using Test Fixtures

```javascript
const fs = require('fs').promises;
const path = require('path');

describe('Transcript Processing', () => {
  let sampleTranscript;

  beforeAll(async () => {
    const fixturePath = path.join(__dirname, '../fixtures/sample_transcript.txt');
    sampleTranscript = await fs.readFile(fixturePath, 'utf-8');
  });

  it('should process transcript', () => {
    const result = processTranscript(sampleTranscript);
    expect(result).toBeDefined();
  });
});
```

## Test Organization Best Practices

### 1. Group Related Tests

Use `describe` blocks to organize related tests:

```javascript
describe('generateArtifactName', () => {
  describe('basic functionality', () => {
    // Basic tests
  });

  describe('edge cases', () => {
    // Edge case tests
  });

  describe('error handling', () => {
    // Error tests
  });
});
```

### 2. Use Clear Test Names

Write descriptive test names that explain what is being tested:

```javascript
// Good
it('should generate unique name when base name already exists', () => {});

// Bad
it('should work', () => {});
```

### 3. Follow AAA Pattern

Arrange, Act, Assert:

```javascript
it('should calculate total', () => {
  // Arrange
  const items = [{ price: 10 }, { price: 20 }];

  // Act
  const total = calculateTotal(items);

  // Assert
  expect(total).toBe(30);
});
```

### 4. Test One Thing Per Test

Each test should verify one specific behavior:

```javascript
// Good
it('should validate email format', () => {});
it('should validate email length', () => {});

// Bad
it('should validate email', () => {
  // Tests both format AND length
});
```

## Continuous Integration

### GitHub Actions Example

```yaml
name: Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm install
      - run: npm test
      - run: npm run test:coverage
      - uses: codecov/codecov-action@v3
        with:
          files: ./coverage/lcov.info
```

### Pre-commit Hook

Add to `.git/hooks/pre-commit`:

```bash
#!/bin/bash
npm test
if [ $? -ne 0 ]; then
  echo "Tests failed. Commit aborted."
  exit 1
fi
```

## Troubleshooting

### Issue: "Cannot find module"

**Solution**: Ensure all dependencies are installed:
```bash
npm install
```

### Issue: "Test timeout"

**Solution**: Increase timeout in test or globally:
```javascript
jest.setTimeout(10000); // 10 seconds
```

Or for specific test:
```javascript
it('long running test', async () => {
  // test code
}, 10000); // 10 second timeout
```

### Issue: "Port already in use"

**Solution**: Ensure previous test server is closed:
```javascript
afterAll(async () => {
  await server.close();
});
```

### Issue: Mock not working

**Solution**: Ensure mocks are properly reset between tests:
```javascript
beforeEach(() => {
  jest.clearAllMocks();
  mockClient.reset();
});
```

## Additional Resources

- [Jest Documentation](https://jestjs.io/docs/getting-started)
- [Supertest Documentation](https://github.com/visionmedia/supertest)
- [Testing Best Practices](https://testingjavascript.com/)

## Contributing

When adding new features:

1. Write tests FIRST (TDD approach recommended)
2. Ensure all existing tests pass
3. Add tests for new functionality
4. Maintain coverage above threshold
5. Document any new test utilities or patterns

## Questions?

If you have questions about the test suite, please:

1. Check this documentation
2. Review existing test files for examples
3. Consult the Jest documentation
4. Open an issue for clarification
