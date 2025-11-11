/**
 * Unit Tests for Utility Functions
 * Tests for getTimestamp, generateArtifactName, parseFilename, parseTopics, etc.
 */

describe('Utility Functions', () => {

  describe('getTimestamp', () => {
    // We need to extract the function from server.js for testing
    // This is a mock implementation for testing purposes
    const getTimestamp = () => {
      const now = new Date();
      return now.toISOString().replace(/[-:]/g, '').replace('T', '_').split('.')[0];
    };

    it('should return a timestamp in the correct format', () => {
      const timestamp = getTimestamp();
      // Format: YYYYMMDD_HHMMSS
      expect(timestamp).toMatch(/^\d{8}_\d{6}$/);
    });

    it('should return unique timestamps when called rapidly', async () => {
      const timestamp1 = getTimestamp();
      await new Promise(resolve => setTimeout(resolve, 1000));
      const timestamp2 = getTimestamp();

      expect(timestamp1).not.toBe(timestamp2);
    });

    it('should not contain invalid characters for filenames', () => {
      const timestamp = getTimestamp();
      expect(timestamp).not.toMatch(/[\/\\:*?"<>|]/);
    });
  });

  describe('generateArtifactName', () => {
    const generateArtifactName = (prompt, existingFiles) => {
      const words = prompt
        .toLowerCase()
        .replace(/[^\w\s]/g, '')
        .split(/\s+/)
        .filter(w => w.length > 3)
        .slice(0, 3);

      let baseName = words.length > 0 ? words.join('-') : 'artifact';
      baseName = baseName.replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-');

      let artifactName = baseName;
      let suffix = 1;

      while (existingFiles.some(f => f.startsWith(`artifact_${artifactName}_v`))) {
        artifactName = `${baseName}-${suffix}`;
        suffix++;
      }

      return artifactName;
    };

    it('should extract meaningful words from prompt', () => {
      const prompt = 'Please summarize the interview transcript';
      const result = generateArtifactName(prompt, []);

      expect(result).toBe('please-summarize-interview');
    });

    it('should handle prompts with special characters', () => {
      const prompt = 'Create a report! What\'s the status?';
      const result = generateArtifactName(prompt, []);

      expect(result).toMatch(/^[a-z0-9-]+$/);
      expect(result).not.toContain('!');
      expect(result).not.toContain('\'');
    });

    it('should return "artifact" for empty or short prompts', () => {
      const result = generateArtifactName('a b c', []);
      expect(result).toBe('artifact');
    });

    it('should handle name collisions by adding suffix', () => {
      const prompt = 'Generate summary report';
      const existingFiles = [
        'artifact_generate-summary-report_v1_20251101_120000.md'
      ];

      const result = generateArtifactName(prompt, existingFiles);
      expect(result).toBe('generate-summary-report-1');
    });

    it('should handle multiple collisions', () => {
      const prompt = 'Generate summary report';
      const existingFiles = [
        'artifact_generate-summary-report_v1_20251101_120000.md',
        'artifact_generate-summary-report-1_v1_20251101_120000.md',
        'artifact_generate-summary-report-2_v1_20251101_120000.md'
      ];

      const result = generateArtifactName(prompt, existingFiles);
      expect(result).toBe('generate-summary-report-3');
    });

    it('should create valid filename-safe names', () => {
      const prompt = 'Analyze user feedback & create insights!';
      const result = generateArtifactName(prompt, []);

      // Should not contain filesystem-unsafe characters
      expect(result).toMatch(/^[a-z0-9-]+$/);
    });

    it('should handle unicode and non-ASCII characters', () => {
      const prompt = 'Créer un résumé français';
      const result = generateArtifactName(prompt, []);

      // Should sanitize non-ASCII
      expect(result).toMatch(/^[a-z0-9-]+$/);
    });
  });

  describe('parseFilename', () => {
    const parseFilename = (filename) => {
      const parts = filename.split('_');
      let type = 'unknown';
      let timestamp = null;
      let version = null;
      let name = null;

      if (filename.startsWith('interview_raw_')) {
        type = 'raw';
        timestamp = parts.slice(2).join('_').replace('.txt', '');
      } else if (filename.startsWith('interview_formatted_')) {
        type = 'formatted';
        timestamp = parts.slice(2).join('_').replace('.md', '');
      } else if (filename.startsWith('artifact_')) {
        type = 'artifact';
        name = parts[1];
        const versionPart = parts[2];
        version = versionPart ? parseInt(versionPart.replace('v', '')) : null;
        timestamp = parts.slice(3).join('_').replace('.md', '');
      } else if (filename.startsWith('prompt_')) {
        type = 'prompt';
        name = parts[1];
        const versionPart = parts[2];
        version = versionPart ? parseInt(versionPart.replace('v', '')) : null;
        timestamp = parts.slice(3).join('_').replace('.txt', '');
      }

      return { type, timestamp, version, name };
    };

    it('should parse raw interview filename', () => {
      const filename = 'interview_raw_20251101_140000.txt';
      const result = parseFilename(filename);

      expect(result.type).toBe('raw');
      expect(result.timestamp).toBe('20251101_140000');
      expect(result.version).toBeNull();
      expect(result.name).toBeNull();
    });

    it('should parse formatted interview filename', () => {
      const filename = 'interview_formatted_20251101_140000.md';
      const result = parseFilename(filename);

      expect(result.type).toBe('formatted');
      expect(result.timestamp).toBe('20251101_140000');
    });

    it('should parse artifact filename', () => {
      const filename = 'artifact_summary_v1_20251101_140000.md';
      const result = parseFilename(filename);

      expect(result.type).toBe('artifact');
      expect(result.name).toBe('summary');
      expect(result.version).toBe(1);
      expect(result.timestamp).toBe('20251101_140000');
    });

    it('should parse prompt filename', () => {
      const filename = 'prompt_extract-insights_v2_20251101_140000.txt';
      const result = parseFilename(filename);

      expect(result.type).toBe('prompt');
      expect(result.name).toBe('extract-insights');
      expect(result.version).toBe(2);
      expect(result.timestamp).toBe('20251101_140000');
    });

    it('should handle unknown filename format', () => {
      const filename = 'random_file_name.txt';
      const result = parseFilename(filename);

      expect(result.type).toBe('unknown');
    });

    it('should parse multi-digit version numbers', () => {
      const filename = 'artifact_test_v15_20251101_140000.md';
      const result = parseFilename(filename);

      expect(result.version).toBe(15);
    });
  });

  describe('parseTopics', () => {
    const parseTopics = (markdownContent) => {
      const topics = [];
      const lines = markdownContent.split('\n');
      let currentTopic = null;
      let currentContent = [];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        if (line.startsWith('## ')) {
          if (currentTopic) {
            topics.push({
              ...currentTopic,
              content: currentContent.join('\n').trim()
            });
          }

          const title = line.substring(3).trim();
          currentTopic = {
            title,
            id: title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
            startLine: i + 1
          };
          currentContent = [line];
        } else if (currentTopic) {
          currentContent.push(line);
        } else {
          if (!topics.length && line.trim()) {
            if (!currentTopic) {
              currentTopic = {
                title: 'Introduction',
                id: 'introduction',
                startLine: 1
              };
              currentContent = [];
            }
            currentContent.push(line);
          }
        }
      }

      if (currentTopic) {
        topics.push({
          ...currentTopic,
          content: currentContent.join('\n').trim()
        });
      }

      return topics;
    };

    it('should extract topics from markdown', () => {
      const markdown = `
## Introduction
This is the intro.

## Technical Discussion
This is technical content.

## Conclusion
This is the end.
`;

      const topics = parseTopics(markdown);

      expect(topics).toHaveLength(3);
      expect(topics[0].title).toBe('Introduction');
      expect(topics[1].title).toBe('Technical Discussion');
      expect(topics[2].title).toBe('Conclusion');
    });

    it('should generate topic IDs', () => {
      const markdown = `## Technical Background & Experience`;
      const topics = parseTopics(markdown);

      expect(topics[0].id).toBe('technical-background-experience');
    });

    it('should handle content before first topic', () => {
      const markdown = `Some preamble text
More preamble

## First Topic
Topic content`;

      const topics = parseTopics(markdown);

      expect(topics[0].title).toBe('Introduction');
      expect(topics[0].content).toContain('preamble');
    });

    it('should handle empty markdown', () => {
      const topics = parseTopics('');
      expect(topics).toHaveLength(0);
    });

    it('should track start line numbers', () => {
      const markdown = `Line 1
Line 2
## Topic One
Content`;

      const topics = parseTopics(markdown);
      expect(topics[1].startLine).toBe(3);
    });

    it('should include full content including nested lists', () => {
      const markdown = `## Topic
- Item 1
- Item 2
  - Sub item
- Item 3`;

      const topics = parseTopics(markdown);
      expect(topics[0].content).toContain('Sub item');
    });
  });

  describe('fillPromptTemplate', () => {
    const fillPromptTemplate = (template, replacements) => {
      let result = template;
      for (const [key, value] of Object.entries(replacements)) {
        result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
      }
      return result;
    };

    it('should replace single placeholder', () => {
      const template = 'Hello {name}!';
      const result = fillPromptTemplate(template, { name: 'World' });

      expect(result).toBe('Hello World!');
    });

    it('should replace multiple placeholders', () => {
      const template = '{greeting} {name}, welcome to {place}!';
      const result = fillPromptTemplate(template, {
        greeting: 'Hello',
        name: 'Alice',
        place: 'Wonderland'
      });

      expect(result).toBe('Hello Alice, welcome to Wonderland!');
    });

    it('should replace multiple occurrences of same placeholder', () => {
      const template = '{name} and {name} went to {place}';
      const result = fillPromptTemplate(template, {
        name: 'Bob',
        place: 'store'
      });

      expect(result).toBe('Bob and Bob went to store');
    });

    it('should handle empty replacements', () => {
      const template = 'Hello {name}!';
      const result = fillPromptTemplate(template, {});

      expect(result).toBe('Hello {name}!');
    });

    it('should handle missing placeholders', () => {
      const template = 'Hello {name}!';
      const result = fillPromptTemplate(template, { other: 'value' });

      expect(result).toBe('Hello {name}!');
    });
  });

  describe('splitIntoChunks', () => {
    const splitIntoChunks = (text, targetChunkSize) => {
      const chunks = [];
      let position = 0;

      while (position < text.length) {
        let chunkEnd = position + targetChunkSize;

        if (chunkEnd >= text.length) {
          chunks.push(text.slice(position));
          break;
        }

        // Simple boundary detection for testing
        const searchStart = Math.max(position, chunkEnd - 1000);
        const searchEnd = Math.min(chunkEnd + 1000, text.length);
        const searchWindow = text.slice(searchStart, searchEnd);

        const paragraphMatch = searchWindow.match(/\n\n/);
        if (paragraphMatch) {
          chunkEnd = searchStart + paragraphMatch.index + 2;
        }

        chunks.push(text.slice(position, chunkEnd));
        position = chunkEnd;
      }

      return { chunks, boundaryInfo: [] };
    };

    it('should split text into chunks of target size', () => {
      const text = 'a'.repeat(10000);
      const { chunks } = splitIntoChunks(text, 3000);

      expect(chunks.length).toBeGreaterThan(1);
      chunks.forEach((chunk, idx) => {
        if (idx < chunks.length - 1) {
          expect(chunk.length).toBeLessThanOrEqual(5000); // With tolerance
        }
      });
    });

    it('should not split short text', () => {
      const text = 'Short text';
      const { chunks } = splitIntoChunks(text, 1000);

      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toBe(text);
    });

    it('should preserve all content', () => {
      const text = 'a'.repeat(5000) + '\n\n' + 'b'.repeat(5000);
      const { chunks } = splitIntoChunks(text, 3000);

      const reconstructed = chunks.join('');
      expect(reconstructed).toBe(text);
    });
  });
});
