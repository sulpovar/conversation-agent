/**
 * Mock Claude API Client for Testing
 */

class MockClaudeClient {
  constructor() {
    this.calls = [];
  }

  async messages(params) {
    this.calls.push({ type: 'message', params });

    // Simulate different response types based on prompt content
    const systemPrompt = params.system || '';
    const userMessage = params.messages?.find(m => m.role === 'user')?.content || '';
    const combinedPrompt = systemPrompt + userMessage;

    // Mock formatting response
    if (combinedPrompt.includes('format') || combinedPrompt.includes('markdown')) {
      return {
        id: 'msg_mock_format',
        type: 'message',
        role: 'assistant',
        content: [{
          type: 'text',
          text: '## Introduction\n\n**[00:00] Speaker:** This is a formatted transcript.'
        }],
        model: 'claude-3-sonnet-20240229',
        stop_reason: 'end_turn',
        usage: { input_tokens: 100, output_tokens: 50 }
      };
    }

    // Mock topic extraction
    if (combinedPrompt.includes('topic') || combinedPrompt.includes('extract')) {
      return {
        id: 'msg_mock_topics',
        type: 'message',
        role: 'assistant',
        content: [{
          type: 'text',
          text: JSON.stringify({
            topics: [
              { title: 'Introduction', id: 'introduction' },
              { title: 'Technical Discussion', id: 'technical-discussion' },
              { title: 'Conclusion', id: 'conclusion' }
            ]
          })
        }],
        model: 'claude-3-sonnet-20240229',
        stop_reason: 'end_turn',
        usage: { input_tokens: 100, output_tokens: 50 }
      };
    }

    // Mock summary response
    if (combinedPrompt.includes('summar')) {
      return {
        id: 'msg_mock_summary',
        type: 'message',
        role: 'assistant',
        content: [{
          type: 'text',
          text: 'This is a comprehensive summary of the interview transcript covering the key topics discussed.'
        }],
        model: 'claude-3-sonnet-20240229',
        stop_reason: 'end_turn',
        usage: { input_tokens: 100, output_tokens: 30 }
      };
    }

    // Default response
    return {
      id: 'msg_mock_default',
      type: 'message',
      role: 'assistant',
      content: [{
        type: 'text',
        text: 'This is a mock response from Claude.'
      }],
      model: 'claude-3-sonnet-20240229',
      stop_reason: 'end_turn',
      usage: { input_tokens: 50, output_tokens: 20 }
    };
  }

  async stream(params) {
    this.calls.push({ type: 'stream', params });

    // Return a mock stream
    const content = 'Streaming response chunk 1. Streaming response chunk 2. Complete.';

    return {
      async *[Symbol.asyncIterator]() {
        const chunks = content.split('. ');
        for (const chunk of chunks) {
          yield {
            type: 'content_block_delta',
            delta: { type: 'text_delta', text: chunk + '. ' }
          };
        }
      }
    };
  }

  reset() {
    this.calls = [];
  }

  getCallCount() {
    return this.calls.length;
  }

  getLastCall() {
    return this.calls[this.calls.length - 1];
  }
}

module.exports = { MockClaudeClient };
