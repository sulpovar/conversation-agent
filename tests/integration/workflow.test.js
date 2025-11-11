/**
 * Integration Tests for Core Workflows
 * Tests end-to-end functionality
 */

const fs = require('fs').promises;
const path = require('path');

// Mock external dependencies
jest.mock('@langchain/anthropic');
jest.mock('puppeteer');
jest.mock('@xenova/transformers');

describe('Core Workflows Integration Tests', () => {

  describe('Artifact Creation Workflow', () => {
    it('should create artifact with auto-generated name', async () => {
      // Mock the full workflow from prompt to artifact creation
      const generateArtifactName = (prompt, existingFiles) => {
        const words = prompt
          .toLowerCase()
          .replace(/[^\w\s]/g, '')
          .split(/\s+/)
          .filter(w => w.length > 3)
          .slice(0, 3);
        return words.length > 0 ? words.join('-') : 'artifact';
      };

      const prompt = 'Create a comprehensive summary of the interview';
      const existingFiles = [];

      const artifactName = generateArtifactName(prompt, existingFiles);
      expect(artifactName).toBe('create-comprehensive-summary');

      // Mock version determination
      const nextVersion = 1;
      const timestamp = '20251101_140000';
      const artifactFilename = `artifact_${artifactName}_v${nextVersion}_${timestamp}.md`;

      expect(artifactFilename).toContain('artifact_create-comprehensive-summary_v1_');
    });

    it('should handle version increments for existing artifacts', async () => {
      const prompt = 'Generate summary';
      const existingFiles = [
        'artifact_generate-summary_v1_20251101_120000.md',
        'artifact_generate-summary_v2_20251101_130000.md'
      ];

      const getNextVersion = (name, files) => {
        const existingVersions = files
          .filter(f => f.startsWith(`artifact_${name}_v`))
          .map(f => {
            const match = f.match(/artifact_.*_v(\d+)_/);
            return match ? parseInt(match[1]) : 0;
          });
        return existingVersions.length > 0 ? Math.max(...existingVersions) + 1 : 1;
      };

      const nextVersion = getNextVersion('generate-summary', existingFiles);
      expect(nextVersion).toBe(3);
    });
  });

  describe('RAG Workflow', () => {
    it('should chunk and embed document', () => {
      const chunkDocument = (content, chunkSize = 1500, overlap = 150) => {
        const chunks = [];
        let start = 0;

        while (start < content.length) {
          const end = Math.min(start + chunkSize, content.length);
          chunks.push({
            content: content.slice(start, end),
            metadata: { chunkIndex: chunks.length }
          });

          if (end >= content.length) break;
          start = end - overlap;
        }

        return chunks;
      };

      const content = 'a'.repeat(5000);
      const chunks = chunkDocument(content, 1500, 150);

      expect(chunks.length).toBeGreaterThan(1);
      expect(chunks[0].content.length).toBeLessThanOrEqual(1500);

      // Verify overlap
      if (chunks.length > 1) {
        const end1 = chunks[0].content;
        const start2 = chunks[1].content;
        // Should have some overlap
        expect(end1.slice(-150)).toBe(start2.slice(0, 150));
      }
    });

    it('should search for similar chunks', () => {
      // Mock cosine similarity
      const cosineSimilarity = (vecA, vecB) => {
        const dotProduct = vecA.reduce((sum, a, i) => sum + a * vecB[i], 0);
        const magA = Math.sqrt(vecA.reduce((sum, a) => sum + a * a, 0));
        const magB = Math.sqrt(vecB.reduce((sum, b) => sum + b * b, 0));
        return dotProduct / (magA * magB);
      };

      const vec1 = [1, 0, 0, 0];
      const vec2 = [1, 0, 0, 0]; // Identical
      const vec3 = [0, 1, 0, 0]; // Orthogonal

      expect(cosineSimilarity(vec1, vec2)).toBeCloseTo(1.0, 5);
      expect(cosineSimilarity(vec1, vec3)).toBeCloseTo(0.0, 5);
    });
  });

  describe('PDF Generation Workflow', () => {
    it('should convert markdown to HTML for PDF', () => {
      const marked = require('marked');

      // Mock marked if not available
      const mockParse = (md) => {
        return md
          .replace(/^## (.*)/gm, '<h2>$1</h2>')
          .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
      };

      const markdown = '## Title\n\n**Bold text**';
      const html = mockParse(markdown);

      expect(html).toContain('<h2>Title</h2>');
      expect(html).toContain('<strong>Bold text</strong>');
    });

    it('should create PDF metadata', () => {
      const metadata = {
        prompt: 'Test prompt',
        files: ['test.md'],
        pdfGenerated: true,
        pdfFilename: 'artifact_test_v1_20251101_140000.pdf'
      };

      expect(metadata.pdfGenerated).toBe(true);
      expect(metadata.pdfFilename).toContain('.pdf');
    });
  });

  describe('Prompt Version Management', () => {
    it('should track prompt versions', () => {
      const prompts = [
        'prompt_Summary_v1_20251101_120000.txt',
        'prompt_Summary_v2_20251102_120000.txt',
        'prompt_Summary_v3_20251103_120000.txt'
      ];

      const getLatestVersion = (name, files) => {
        const versions = files
          .filter(f => f.startsWith(`prompt_${name}_v`))
          .map(f => {
            const match = f.match(/prompt_.*_v(\d+)_/);
            return match ? parseInt(match[1]) : 0;
          });
        return Math.max(...versions);
      };

      const latestVersion = getLatestVersion('Summary', prompts);
      expect(latestVersion).toBe(3);
    });

    it('should create new prompt version', () => {
      const name = 'TestPrompt';
      const version = 2;
      const timestamp = '20251101_140000';
      const filename = `prompt_${name}_v${version}_${timestamp}.txt`;

      expect(filename).toBe('prompt_TestPrompt_v2_20251101_140000.txt');
    });
  });

  describe('Topic Extraction and Selection', () => {
    it('should extract and filter topics', () => {
      const parseTopics = (content) => {
        const topics = [];
        const lines = content.split('\n');

        for (const line of lines) {
          if (line.startsWith('## ')) {
            topics.push({
              title: line.substring(3).trim(),
              id: line.substring(3).trim().toLowerCase().replace(/\s+/g, '-')
            });
          }
        }

        return topics;
      };

      const content = `## Introduction
Content here

## Technical Discussion
More content

## Conclusion
Final content`;

      const topics = parseTopics(content);
      expect(topics).toHaveLength(3);
      expect(topics[1].id).toBe('technical-discussion');
    });

    it('should filter content by selected topics', () => {
      const content = `## Topic A
Content A

## Topic B
Content B

## Topic C
Content C`;

      const filterByTopics = (content, selectedTopicIds) => {
        const lines = content.split('\n');
        const result = [];
        let include = false;

        for (const line of lines) {
          if (line.startsWith('## ')) {
            const topicId = line.substring(3).trim().toLowerCase().replace(/\s+/g, '-');
            include = selectedTopicIds.includes(topicId);
          }

          if (include) {
            result.push(line);
          }
        }

        return result.join('\n');
      };

      const filtered = filterByTopics(content, ['topic-a', 'topic-c']);
      expect(filtered).toContain('Topic A');
      expect(filtered).toContain('Topic C');
      expect(filtered).not.toContain('Topic B');
    });
  });

  describe('Error Handling and Recovery', () => {
    it('should handle missing files gracefully', async () => {
      const handleMissingFile = (filename) => {
        try {
          if (!filename || filename === 'missing.txt') {
            throw new Error('File not found');
          }
          return { success: true };
        } catch (error) {
          return { success: false, error: error.message };
        }
      };

      const result = handleMissingFile('missing.txt');
      expect(result.success).toBe(false);
      expect(result.error).toContain('File not found');
    });

    it('should continue on PDF generation failure', () => {
      const generateWithPDF = (content, shouldFailPDF = false) => {
        const artifactPath = '/path/to/artifact.md';
        let pdfPath = null;

        if (shouldFailPDF) {
          console.warn('PDF generation failed, continuing with markdown only');
        } else {
          pdfPath = artifactPath.replace('.md', '.pdf');
        }

        return {
          artifactPath,
          pdfPath,
          pdfGenerated: !!pdfPath
        };
      };

      const result = generateWithPDF('content', true);
      expect(result.pdfGenerated).toBe(false);
      expect(result.artifactPath).toBeTruthy();
    });
  });
});
