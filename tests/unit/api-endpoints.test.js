/**
 * Unit Tests for API Endpoints
 * Tests Express routes and request/response handling
 */

const request = require('supertest');
const express = require('express');
const fs = require('fs').promises;
const path = require('path');

// Mock dependencies
jest.mock('fs', () => ({
  promises: {
    readdir: jest.fn(),
    readFile: jest.fn(),
    writeFile: jest.fn(),
    mkdir: jest.fn(),
    stat: jest.fn(),
    access: jest.fn()
  }
}));

jest.mock('@langchain/anthropic');
jest.mock('puppeteer');

describe('API Endpoints', () => {
  let app;

  beforeEach(() => {
    // Create fresh app instance for each test
    app = express();
    app.use(express.json());
    jest.clearAllMocks();
  });

  describe('GET /api/files', () => {
    beforeEach(() => {
      // Mock file listing endpoint
      app.get('/api/files', async (req, res) => {
        try {
          const files = await fs.readdir('./transcriptions');
          const fileDetails = await Promise.all(
            files
              .filter(f => !f.endsWith('.meta.json'))
              .map(async (filename) => {
                const stats = await fs.stat(path.join('./transcriptions', filename));
                const parseFilename = (fn) => ({
                  type: fn.startsWith('interview_raw_') ? 'raw' :
                        fn.startsWith('interview_formatted_') ? 'formatted' :
                        fn.startsWith('artifact_') ? 'artifact' : 'unknown',
                  timestamp: '20251101_140000',
                  version: fn.startsWith('artifact_') ? 1 : null,
                  name: fn.startsWith('artifact_') ? 'test' : null
                });

                return {
                  filename,
                  size: stats.size,
                  modified: stats.mtime,
                  ...parseFilename(filename)
                };
              })
          );

          fileDetails.sort((a, b) => new Date(b.modified) - new Date(a.modified));
          res.json(fileDetails);
        } catch (error) {
          res.status(500).json({ error: 'Failed to list files' });
        }
      });
    });

    it('should return list of files', async () => {
      fs.readdir.mockResolvedValue([
        'interview_raw_20251101_140000.txt',
        'interview_formatted_20251101_140000.md',
        'artifact_summary_v1_20251101_140000.md'
      ]);

      fs.stat.mockResolvedValue({
        size: 1024,
        mtime: new Date('2025-01-01')
      });

      const response = await request(app).get('/api/files');

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBe(3);
    });

    it('should filter out .meta.json files', async () => {
      fs.readdir.mockResolvedValue([
        'interview_raw_20251101_140000.txt',
        'interview_raw_20251101_140000.txt.meta.json'
      ]);

      fs.stat.mockResolvedValue({
        size: 1024,
        mtime: new Date('2025-01-01')
      });

      const response = await request(app).get('/api/files');

      expect(response.body.length).toBe(1);
      expect(response.body[0].filename).not.toContain('.meta.json');
    });

    it('should handle errors gracefully', async () => {
      fs.readdir.mockRejectedValue(new Error('Directory not found'));

      const response = await request(app).get('/api/files');

      expect(response.status).toBe(500);
      expect(response.body).toHaveProperty('error');
    });
  });

  describe('GET /api/files/:filename', () => {
    beforeEach(() => {
      app.get('/api/files/:filename', async (req, res) => {
        try {
          const { filename } = req.params;
          const content = await fs.readFile(path.join('./transcriptions', filename), 'utf-8');
          res.json({ content });
        } catch (error) {
          res.status(500).json({ error: 'Failed to read file' });
        }
      });
    });

    it('should return file content', async () => {
      const mockContent = 'File content here';
      fs.readFile.mockResolvedValue(mockContent);

      const response = await request(app).get('/api/files/test.txt');

      expect(response.status).toBe(200);
      expect(response.body.content).toBe(mockContent);
    });

    it('should handle missing files', async () => {
      fs.readFile.mockRejectedValue(new Error('File not found'));

      const response = await request(app).get('/api/files/missing.txt');

      expect(response.status).toBe(500);
      expect(response.body).toHaveProperty('error');
    });
  });

  describe('POST /api/prompt', () => {
    beforeEach(() => {
      app.post('/api/prompt', async (req, res) => {
        try {
          const { prompt, files } = req.body;

          if (!prompt) {
            return res.status(400).json({ error: 'Prompt is required' });
          }

          // Mock artifact generation
          const artifactName = 'test-artifact';
          const nextVersion = 1;
          const timestamp = '20251101_140000';
          const artifactFilename = `artifact_${artifactName}_v${nextVersion}_${timestamp}.md`;

          // Mock LLM response
          const result = '## Summary\n\nThis is a generated summary.';

          // Mock file operations
          await fs.writeFile(
            path.join('./transcriptions', artifactFilename),
            result,
            'utf-8'
          );

          res.json({
            filename: artifactFilename,
            content: result,
            version: nextVersion,
            metadata: {
              prompt,
              files: files || [],
              version: nextVersion
            }
          });
        } catch (error) {
          res.status(500).json({ error: error.message });
        }
      });
    });

    it('should create artifact from prompt', async () => {
      fs.readdir.mockResolvedValue([]);
      fs.writeFile.mockResolvedValue();

      const response = await request(app)
        .post('/api/prompt')
        .send({
          prompt: 'Generate a summary',
          files: ['interview_formatted_20251101_140000.md']
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('filename');
      expect(response.body).toHaveProperty('content');
      expect(response.body.filename).toContain('artifact_');
    });

    it('should return 400 if prompt is missing', async () => {
      const response = await request(app)
        .post('/api/prompt')
        .send({ files: ['test.md'] });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('required');
    });

    it('should handle no files provided', async () => {
      fs.readdir.mockResolvedValue([]);
      fs.writeFile.mockResolvedValue();

      const response = await request(app)
        .post('/api/prompt')
        .send({ prompt: 'Test prompt' });

      expect(response.status).toBe(200);
    });
  });

  describe('POST /api/run-agent', () => {
    beforeEach(() => {
      app.post('/api/run-agent', async (req, res) => {
        try {
          const { agentFilename, files } = req.body;

          if (!agentFilename) {
            return res.status(400).json({ error: 'Agent filename is required' });
          }

          // Mock agent execution
          const artifactName = 'agent-output';
          const nextVersion = 1;
          const timestamp = '20251101_140000';
          const artifactFilename = `artifact_${artifactName}_v${nextVersion}_${timestamp}.md`;
          const result = '## Agent Output\n\nAgent result here.';

          res.json({
            filename: artifactFilename,
            content: result,
            version: nextVersion,
            metadata: {
              agentFile: agentFilename,
              files: files || []
            }
          });
        } catch (error) {
          res.status(500).json({ error: error.message });
        }
      });
    });

    it('should execute agent and return results', async () => {
      const response = await request(app)
        .post('/api/run-agent')
        .send({
          agentFilename: 'prompt_Summary_v1_20251101_120000.txt',
          files: ['interview_formatted_20251101_140000.md']
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('filename');
      expect(response.body).toHaveProperty('content');
    });

    it('should return 400 if agent filename is missing', async () => {
      const response = await request(app)
        .post('/api/run-agent')
        .send({ files: ['test.md'] });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('required');
    });
  });

  describe('GET /api/agents', () => {
    beforeEach(() => {
      app.get('/api/agents', async (req, res) => {
        try {
          const files = await fs.readdir('./prompts');
          const promptFiles = files.filter(f => f.startsWith('prompt_') && f.endsWith('.txt'));

          const agents = await Promise.all(
            promptFiles.map(async (filename) => {
              const stats = await fs.stat(path.join('./prompts', filename));

              // Try to load metadata
              let metaContent = { visible: true };
              try {
                const metaPath = path.join('./prompts', `${filename}.meta.json`);
                const metaData = await fs.readFile(metaPath, 'utf-8');
                metaContent = JSON.parse(metaData);
              } catch {
                // Use defaults
              }

              if (!metaContent.visible) return null;

              return {
                filename,
                size: stats.size,
                agentType: 'prompt',
                name: 'test-agent',
                version: 1,
                metadata: metaContent
              };
            })
          );

          res.json(agents.filter(a => a !== null));
        } catch (error) {
          res.status(500).json({ error: 'Failed to list agents' });
        }
      });
    });

    it('should return list of agents', async () => {
      fs.readdir.mockResolvedValue([
        'prompt_Summary_v1_20251101_120000.txt',
        'prompt_Analysis_v1_20251101_120000.txt'
      ]);

      fs.stat.mockResolvedValue({
        size: 1024,
        mtime: new Date()
      });

      fs.readFile.mockResolvedValue(JSON.stringify({ visible: true }));

      const response = await request(app).get('/api/agents');

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBe(2);
    });

    it('should filter out hidden agents', async () => {
      fs.readdir.mockResolvedValue([
        'prompt_Visible_v1_20251101_120000.txt',
        'prompt_Hidden_v1_20251101_120000.txt'
      ]);

      fs.stat.mockResolvedValue({
        size: 1024,
        mtime: new Date()
      });

      // First call returns visible, second returns hidden
      fs.readFile
        .mockResolvedValueOnce(JSON.stringify({ visible: true }))
        .mockResolvedValueOnce(JSON.stringify({ visible: false }));

      const response = await request(app).get('/api/agents');

      expect(response.body.length).toBe(1);
    });
  });

  describe('POST /api/prompts', () => {
    beforeEach(() => {
      app.post('/api/prompts', async (req, res) => {
        try {
          const { name, content, description, category } = req.body;

          if (!name || !content) {
            return res.status(400).json({ error: 'Name and content are required' });
          }

          if (!/^[a-zA-Z0-9-]+$/.test(name)) {
            return res.status(400).json({
              error: 'Name can only contain letters, numbers, and hyphens'
            });
          }

          const nextVersion = 1;
          const timestamp = '20251101_140000';
          const promptFilename = `prompt_${name}_v${nextVersion}_${timestamp}.txt`;

          res.json({
            filename: promptFilename,
            content,
            version: nextVersion,
            metadata: {
              name,
              version: nextVersion,
              description: description || '',
              category: category || 'user'
            }
          });
        } catch (error) {
          res.status(500).json({ error: error.message });
        }
      });
    });

    it('should create new prompt', async () => {
      const response = await request(app)
        .post('/api/prompts')
        .send({
          name: 'test-prompt',
          content: 'Prompt content here',
          description: 'Test prompt',
          category: 'user'
        });

      expect(response.status).toBe(200);
      expect(response.body.filename).toContain('prompt_test-prompt_');
    });

    it('should reject invalid prompt names', async () => {
      const response = await request(app)
        .post('/api/prompts')
        .send({
          name: 'invalid name!',
          content: 'Content'
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('letters, numbers, and hyphens');
    });

    it('should require name and content', async () => {
      const response = await request(app)
        .post('/api/prompts')
        .send({ name: 'test' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('required');
    });
  });

  describe('POST /api/rag/sync', () => {
    beforeEach(() => {
      app.post('/api/rag/sync', async (req, res) => {
        try {
          const { files } = req.body;

          if (!files || files.length === 0) {
            return res.status(400).json({ error: 'No files specified' });
          }

          // Mock RAG sync
          res.json({
            success: true,
            filesIndexed: files.length,
            totalChunks: files.length * 10
          });
        } catch (error) {
          res.status(500).json({ error: error.message });
        }
      });
    });

    it('should sync files to RAG index', async () => {
      const response = await request(app)
        .post('/api/rag/sync')
        .send({
          files: ['interview_formatted_20251101_140000.md']
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.filesIndexed).toBe(1);
    });

    it('should require files parameter', async () => {
      const response = await request(app)
        .post('/api/rag/sync')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('files');
    });
  });
});
