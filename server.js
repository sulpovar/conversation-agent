require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const PORT = process.env.PORT || 3000;
const TRANSCRIPTIONS_DIR = process.env.TRANSCRIPTIONS_DIR || './transcriptions';
const PROMPTS_DIR = process.env.PROMPTS_DIR || './prompts';
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-3-5-haiku-20241022';
const SYSTEM_PROMPT_SINGLE_CHUNK = process.env.SYSTEM_PROMPT_SINGLE_CHUNK || 'format-single-chunk';
const SYSTEM_PROMPT_MULTI_CHUNK = process.env.SYSTEM_PROMPT_MULTI_CHUNK || 'format-multi-chunk';
const CHUNK_SIZE = parseInt(process.env.CHUNK_SIZE || '100000');
const REQUEST_SIZE_LIMIT = process.env.REQUEST_SIZE_LIMIT || '50mb';
const MAX_TOKENS_TRANSCRIPTION = parseInt(process.env.MAX_TOKENS_TRANSCRIPTION || '4096');
const MAX_TOKENS_PROMPT = parseInt(process.env.MAX_TOKENS_PROMPT || '8192');
const DEBUG_WRITE_CHUNKS = process.env.DEBUG_WRITE_CHUNKS === 'true';

const anthropic = new Anthropic({
  apiKey: process.env.CLAUDE_API_KEY,
});

app.use(cors());
app.use(express.json({ limit: REQUEST_SIZE_LIMIT }));
app.use(express.static('public'));

// Ensure transcriptions and prompts directories exist
async function ensureDirectories() {
  try {
    await fs.mkdir(TRANSCRIPTIONS_DIR, { recursive: true });
    console.log(`✓ Transcriptions directory ready: ${TRANSCRIPTIONS_DIR}`);
    await fs.mkdir(PROMPTS_DIR, { recursive: true });
    console.log(`✓ Prompts directory ready: ${PROMPTS_DIR}`);
  } catch (error) {
    console.error('Error creating directories:', error);
  }
}

// Format timestamp for filenames
function getTimestamp() {
  const now = new Date();
  return now.toISOString().replace(/[-:]/g, '').replace('T', '_').split('.')[0];
}

// Parse filename to extract metadata
function parseFilename(filename) {
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
}

// Split text into chunks
function splitIntoChunks(text, chunkSize) {
  const chunks = [];
  for (let i = 0; i < text.length; i += chunkSize) {
    chunks.push(text.slice(i, i + chunkSize));
  }
  return chunks;
}

// Load system prompt from file
async function loadSystemPrompt(promptName) {
  try {
    const files = await fs.readdir(PROMPTS_DIR);
    const promptFile = files.find(f => f.startsWith(`system_${promptName}_v1_`) && f.endsWith('.txt'));

    if (!promptFile) {
      throw new Error(`System prompt not found: ${promptName}`);
    }

    const promptPath = path.join(PROMPTS_DIR, promptFile);
    const content = await fs.readFile(promptPath, 'utf-8');
    return content;
  } catch (error) {
    console.error(`Error loading system prompt ${promptName}:`, error.message);
    throw error;
  }
}

// Replace placeholders in prompt template
function fillPromptTemplate(template, replacements) {
  let result = template;
  for (const [key, value] of Object.entries(replacements)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
  }
  return result;
}

// Format transcription using Claude with prompts from files
async function formatTranscription(rawText) {
  const startTime = Date.now();
  const chunks = splitIntoChunks(rawText, CHUNK_SIZE);
  const formattedChunks = [];

  const documentSize = Buffer.byteLength(rawText, 'utf8');
  console.log(`📄 Document size: ${(documentSize / 1024).toFixed(2)} KB`);
  console.log(`📦 Formatting transcription in ${chunks.length} chunk(s)...`);

  // Load appropriate prompt template based on chunk count
  const promptName = chunks.length > 1 ? SYSTEM_PROMPT_MULTI_CHUNK : SYSTEM_PROMPT_SINGLE_CHUNK;
  const promptTemplate = await loadSystemPrompt(promptName);

  for (let i = 0; i < chunks.length; i++) {
    const chunkStartTime = Date.now();
    const chunkSize = Buffer.byteLength(chunks[i], 'utf8');
    console.log(`\n🔄 Processing chunk ${i + 1}/${chunks.length} (${(chunkSize / 1024).toFixed(2)} KB)...`);

    // Fill in the template with actual values
    const prompt = chunks.length > 1
      ? fillPromptTemplate(promptTemplate, {
          chunk_number: (i + 1).toString(),
          total_chunks: chunks.length.toString(),
          content: chunks[i]
        })
      : fillPromptTemplate(promptTemplate, {
          content: chunks[i]
        });

    try {
      const apiStartTime = Date.now();
      const message = await anthropic.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: MAX_TOKENS_TRANSCRIPTION,
        messages: [{
          role: 'user',
          content: prompt
        }]
      });

      const apiDuration = Date.now() - apiStartTime;
      const outputTokens = message.usage?.output_tokens || 0;
      const inputTokens = message.usage?.input_tokens || 0;

      formattedChunks.push(message.content[0].text);

      const chunkDuration = Date.now() - chunkStartTime;
      console.log(`✅ Chunk ${i + 1} completed in ${(chunkDuration / 1000).toFixed(2)}s (API: ${(apiDuration / 1000).toFixed(2)}s)`);
      console.log(`   📊 Tokens - Input: ${inputTokens}, Output: ${outputTokens}`);
    } catch (error) {
      const chunkDuration = Date.now() - chunkStartTime;
      console.error(`❌ Error formatting chunk ${i + 1} after ${(chunkDuration / 1000).toFixed(2)}s:`, error.message);
      formattedChunks.push(`\n\n## Chunk ${i + 1} (Error formatting)\n\n${chunks[i]}\n\n`);
    }
  }

  const totalDuration = Date.now() - startTime;
  console.log(`\n⏱️  Total formatting time: ${(totalDuration / 1000).toFixed(2)}s for ${chunks.length} chunk(s)`);
  console.log(`   Average: ${(totalDuration / chunks.length / 1000).toFixed(2)}s per chunk\n`);

  // Verify all chunks were processed
  if (formattedChunks.length !== chunks.length) {
    console.warn(`⚠️  Warning: Expected ${chunks.length} formatted chunks but got ${formattedChunks.length}`);
  } else {
    console.log(`✅ All ${chunks.length} chunk(s) successfully formatted`);
  }

  // Combine chunks with section markers if multiple
  if (chunks.length > 1) {
    console.log(`\n📊 Chunk size comparison:`);
    for (let i = 0; i < chunks.length; i++) {
      const originalSize = Buffer.byteLength(chunks[i], 'utf8');
      const formattedSize = formattedChunks[i] ? Buffer.byteLength(formattedChunks[i], 'utf8') : 0;
      console.log(`   Chunk ${i + 1}: Original ${(originalSize / 1024).toFixed(2)} KB → Formatted ${(formattedSize / 1024).toFixed(2)} KB`);

      // Write chunks to debug files if enabled
      if (DEBUG_WRITE_CHUNKS) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
        const originalChunkPath = path.join(TRANSCRIPTIONS_DIR, `debug_chunk_${i + 1}_original_${timestamp}.txt`);
        const formattedChunkPath = path.join(TRANSCRIPTIONS_DIR, `debug_chunk_${i + 1}_formatted_${timestamp}.txt`);

        try {
          fs.writeFile(originalChunkPath, chunks[i], 'utf8');
          if (formattedChunks[i]) {
            fs.writeFile(formattedChunkPath, formattedChunks[i], 'utf8');
          }
          console.log(`   📝 Written: debug_chunk_${i + 1}_original_${timestamp}.txt & debug_chunk_${i + 1}_formatted_${timestamp}.txt`);
        } catch (error) {
          console.error(`   ❌ Error writing chunk ${i + 1} debug files:`, error.message);
        }
      }
    }

    const combined = formattedChunks.join('\n\n---\n\n');
    const inputSize = Buffer.byteLength(rawText, 'utf8');
    const outputSize = Buffer.byteLength(combined, 'utf8');
    console.log(`📋 Combined result: ${(outputSize / 1024).toFixed(2)} KB (from ${(inputSize / 1024).toFixed(2)} KB input)\n`);
    return combined;
  }

  const inputSize = Buffer.byteLength(rawText, 'utf8');
  const outputSize = Buffer.byteLength(formattedChunks[0], 'utf8');
  console.log(`📋 Result: ${(outputSize / 1024).toFixed(2)} KB (from ${(inputSize / 1024).toFixed(2)} KB input)\n`);
  return formattedChunks[0];
}

// Process raw transcriptions on startup
async function processRawTranscriptions() {
  try {
    const startTime = Date.now();
    const files = await fs.readdir(TRANSCRIPTIONS_DIR);
    const rawFiles = files.filter(f => f.startsWith('interview_raw_') && f.endsWith('.txt'));

    if (rawFiles.length === 0) {
      console.log('ℹ️  No raw transcriptions found to process.');
      return;
    }

    console.log(`\n📋 Found ${rawFiles.length} raw transcription(s) to check...`);

    let processedCount = 0;
    let skippedCount = 0;

    for (const rawFile of rawFiles) {
      const { timestamp } = parseFilename(rawFile);
      const formattedFile = `interview_formatted_${timestamp}.md`;
      const formattedPath = path.join(TRANSCRIPTIONS_DIR, formattedFile);

      // Check if formatted version already exists
      try {
        await fs.access(formattedPath);
        console.log(`   ✓ Already formatted: ${rawFile}`);
        skippedCount++;
        continue;
      } catch {
        // File doesn't exist, proceed with formatting
      }

      console.log(`\n📝 Formatting new transcription: ${rawFile}`);
      const fileStartTime = Date.now();
      const rawPath = path.join(TRANSCRIPTIONS_DIR, rawFile);
      const rawText = await fs.readFile(rawPath, 'utf-8');

      const formatted = await formatTranscription(rawText);
      await fs.writeFile(formattedPath, formatted, 'utf-8');

      // Create metadata file
      const metaPath = path.join(TRANSCRIPTIONS_DIR, `${formattedFile}.meta.json`);
      const metadata = {
        sourceFile: rawFile,
        createdAt: new Date().toISOString(),
        model: CLAUDE_MODEL,
        type: 'formatted_transcription'
      };
      await fs.writeFile(metaPath, JSON.stringify(metadata, null, 2), 'utf-8');

      const fileDuration = Date.now() - fileStartTime;
      console.log(`✅ Created: ${formattedFile} (total: ${(fileDuration / 1000).toFixed(2)}s)`);
      processedCount++;
    }

    const totalDuration = Date.now() - startTime;
    console.log(`\n📊 Transcription processing complete:`);
    console.log(`   ✅ Formatted: ${processedCount}`);
    console.log(`   ⏭️  Skipped: ${skippedCount}`);
    console.log(`   ⏱️  Total time: ${(totalDuration / 1000).toFixed(2)}s\n`);
  } catch (error) {
    console.error('❌ Error processing raw transcriptions:', error);
  }
}

// API: List all files
app.get('/api/files', async (req, res) => {
  try {
    const files = await fs.readdir(TRANSCRIPTIONS_DIR);
    const fileDetails = await Promise.all(
      files
        .filter(f => !f.endsWith('.meta.json'))
        .map(async (filename) => {
          const filePath = path.join(TRANSCRIPTIONS_DIR, filename);
          const stats = await fs.stat(filePath);
          const metadata = parseFilename(filename);

          // Try to load metadata file if exists
          let metaContent = null;
          try {
            const metaPath = path.join(TRANSCRIPTIONS_DIR, `${filename}.meta.json`);
            const metaData = await fs.readFile(metaPath, 'utf-8');
            metaContent = JSON.parse(metaData);
          } catch {
            // No metadata file
          }

          return {
            filename,
            size: stats.size,
            modified: stats.mtime,
            ...metadata,
            metadata: metaContent
          };
        })
    );

    // Sort by modified date (newest first)
    fileDetails.sort((a, b) => new Date(b.modified) - new Date(a.modified));

    res.json(fileDetails);
  } catch (error) {
    console.error('Error listing files:', error);
    res.status(500).json({ error: 'Failed to list files' });
  }
});

// API: Read file content
app.get('/api/files/:filename', async (req, res) => {
  try {
    const { filename } = req.params;
    const filePath = path.join(TRANSCRIPTIONS_DIR, filename);
    const content = await fs.readFile(filePath, 'utf-8');
    res.json({ content });
  } catch (error) {
    console.error('Error reading file:', error);
    res.status(500).json({ error: 'Failed to read file' });
  }
});

// API: Run prompt with files
app.post('/api/prompt', async (req, res) => {
  try {
    const { prompt, files, artifactName } = req.body;

    if (!prompt || !artifactName) {
      return res.status(400).json({ error: 'Prompt and artifact name are required' });
    }

    // Read file contents
    let contextText = '';
    if (files && files.length > 0) {
      const fileContents = await Promise.all(
        files.map(async (filename) => {
          const filePath = path.join(TRANSCRIPTIONS_DIR, filename);
          const content = await fs.readFile(filePath, 'utf-8');
          return `\n\n--- File: ${filename} ---\n\n${content}`;
        })
      );
      contextText = fileContents.join('\n\n');
    }

    // Determine next version number
    const existingFiles = await fs.readdir(TRANSCRIPTIONS_DIR);
    const existingVersions = existingFiles
      .filter(f => f.startsWith(`artifact_${artifactName}_v`))
      .map(f => {
        const match = f.match(/artifact_.*_v(\d+)_/);
        return match ? parseInt(match[1]) : 0;
      });
    const nextVersion = existingVersions.length > 0 ? Math.max(...existingVersions) + 1 : 1;

    // Call Claude
    const fullPrompt = `${prompt}\n\n${contextText}`;
    const promptSize = Buffer.byteLength(fullPrompt, 'utf8');

    console.log(`\n🚀 Running custom prompt for artifact: ${artifactName} (v${nextVersion})`);
    console.log(`   📄 Prompt size: ${(promptSize / 1024).toFixed(2)} KB`);
    console.log(`   📎 Context files: ${files?.length || 0}`);

    const startTime = Date.now();
    const message = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: MAX_TOKENS_PROMPT,
      messages: [{
        role: 'user',
        content: fullPrompt
      }]
    });

    const duration = Date.now() - startTime;
    const outputTokens = message.usage?.output_tokens || 0;
    const inputTokens = message.usage?.input_tokens || 0;

    console.log(`✅ Prompt completed in ${(duration / 1000).toFixed(2)}s`);
    console.log(`   📊 Tokens - Input: ${inputTokens}, Output: ${outputTokens}\n`);

    const result = message.content[0].text;

    // Save artifact
    const timestamp = getTimestamp();
    const artifactFilename = `artifact_${artifactName}_v${nextVersion}_${timestamp}.md`;
    const artifactPath = path.join(TRANSCRIPTIONS_DIR, artifactFilename);
    await fs.writeFile(artifactPath, result, 'utf-8');

    // Save metadata
    const metaPath = path.join(TRANSCRIPTIONS_DIR, `${artifactFilename}.meta.json`);
    const metadata = {
      prompt,
      files: files || [],
      version: nextVersion,
      createdAt: new Date().toISOString(),
      model: CLAUDE_MODEL,
      type: 'prompt_artifact'
    };
    await fs.writeFile(metaPath, JSON.stringify(metadata, null, 2), 'utf-8');

    console.log(`✓ Created: ${artifactFilename}`);

    res.json({
      filename: artifactFilename,
      content: result,
      version: nextVersion,
      metadata
    });
  } catch (error) {
    console.error('Error running prompt:', error);
    res.status(500).json({ error: error.message || 'Failed to run prompt' });
  }
});

// API: Re-run prompt (create new version)
app.post('/api/rerun-prompt', async (req, res) => {
  try {
    const { filename } = req.body;

    if (!filename) {
      return res.status(400).json({ error: 'Filename is required' });
    }

    // Load metadata
    const metaPath = path.join(TRANSCRIPTIONS_DIR, `${filename}.meta.json`);
    const metaData = await fs.readFile(metaPath, 'utf-8');
    const metadata = JSON.parse(metaData);

    // Extract artifact name from filename
    const { name: artifactName } = parseFilename(filename);

    // Re-run the prompt
    const result = await app.request.post('/api/prompt', {
      body: {
        prompt: metadata.prompt,
        files: metadata.files,
        artifactName
      }
    });

    res.json(result);
  } catch (error) {
    console.error('Error re-running prompt:', error);
    res.status(500).json({ error: 'Failed to re-run prompt' });
  }
});

// ===== PROMPT MANAGEMENT APIs =====

// API: List all prompts (only visible ones)
app.get('/api/prompts', async (req, res) => {
  try {
    const files = await fs.readdir(PROMPTS_DIR);
    const promptFiles = files.filter(f => f.startsWith('prompt_') && f.endsWith('.txt'));

    const prompts = await Promise.all(
      promptFiles.map(async (filename) => {
        const filePath = path.join(PROMPTS_DIR, filename);
        const stats = await fs.stat(filePath);
        const metadata = parseFilename(filename);

        // Load metadata file
        let metaContent = null;
        try {
          const metaPath = path.join(PROMPTS_DIR, `${filename}.meta.json`);
          const metaData = await fs.readFile(metaPath, 'utf-8');
          metaContent = JSON.parse(metaData);
        } catch {
          // No metadata file, default to visible
          metaContent = { visible: true };
        }

        // Only return visible prompts
        if (!metaContent.visible) {
          return null;
        }

        return {
          filename,
          size: stats.size,
          modified: stats.mtime,
          ...metadata,
          metadata: metaContent
        };
      })
    );

    // Filter out null values (hidden prompts) and sort by name and version
    const visiblePrompts = prompts
      .filter(p => p !== null)
      .sort((a, b) => {
        if (a.name !== b.name) {
          return a.name.localeCompare(b.name);
        }
        return (b.version || 0) - (a.version || 0);
      });

    res.json(visiblePrompts);
  } catch (error) {
    console.error('Error listing prompts:', error);
    res.status(500).json({ error: 'Failed to list prompts' });
  }
});

// API: Get prompt content
app.get('/api/prompts/:filename', async (req, res) => {
  try {
    const { filename } = req.params;
    const filePath = path.join(PROMPTS_DIR, filename);
    const content = await fs.readFile(filePath, 'utf-8');

    // Load metadata
    let metaContent = null;
    try {
      const metaPath = path.join(PROMPTS_DIR, `${filename}.meta.json`);
      const metaData = await fs.readFile(metaPath, 'utf-8');
      metaContent = JSON.parse(metaData);
    } catch {
      metaContent = { visible: true };
    }

    res.json({ content, metadata: metaContent });
  } catch (error) {
    console.error('Error reading prompt:', error);
    res.status(500).json({ error: 'Failed to read prompt' });
  }
});

// API: Create new prompt
app.post('/api/prompts', async (req, res) => {
  try {
    const { name, content, description, category } = req.body;

    if (!name || !content) {
      return res.status(400).json({ error: 'Name and content are required' });
    }

    // Validate name (alphanumeric and hyphens only)
    if (!/^[a-zA-Z0-9-]+$/.test(name)) {
      return res.status(400).json({ error: 'Name can only contain letters, numbers, and hyphens' });
    }

    // Determine next version number
    const existingFiles = await fs.readdir(PROMPTS_DIR);
    const existingVersions = existingFiles
      .filter(f => f.startsWith(`prompt_${name}_v`))
      .map(f => {
        const match = f.match(/prompt_.*_v(\d+)_/);
        return match ? parseInt(match[1]) : 0;
      });
    const nextVersion = existingVersions.length > 0 ? Math.max(...existingVersions) + 1 : 1;

    // Create prompt file
    const timestamp = getTimestamp();
    const promptFilename = `prompt_${name}_v${nextVersion}_${timestamp}.txt`;
    const promptPath = path.join(PROMPTS_DIR, promptFilename);
    await fs.writeFile(promptPath, content, 'utf-8');

    // Create metadata file
    const metaPath = path.join(PROMPTS_DIR, `${promptFilename}.meta.json`);
    const metadata = {
      name,
      version: nextVersion,
      description: description || '',
      category: category || 'user',
      createdAt: new Date().toISOString(),
      visible: true,
      type: 'user',
      parentVersion: nextVersion > 1 ? nextVersion - 1 : null
    };
    await fs.writeFile(metaPath, JSON.stringify(metadata, null, 2), 'utf-8');

    console.log(`✓ Created prompt: ${promptFilename}`);

    res.json({
      filename: promptFilename,
      content,
      version: nextVersion,
      metadata
    });
  } catch (error) {
    console.error('Error creating prompt:', error);
    res.status(500).json({ error: error.message || 'Failed to create prompt' });
  }
});

// API: Edit prompt (creates new version)
app.post('/api/prompts/edit', async (req, res) => {
  try {
    const { filename, content, description } = req.body;

    if (!filename || !content) {
      return res.status(400).json({ error: 'Filename and content are required' });
    }

    // Parse original filename
    const { name } = parseFilename(filename);

    if (!name) {
      return res.status(400).json({ error: 'Invalid prompt filename' });
    }

    // Load original metadata to get category
    let originalMeta = {};
    try {
      const originalMetaPath = path.join(PROMPTS_DIR, `${filename}.meta.json`);
      const originalMetaData = await fs.readFile(originalMetaPath, 'utf-8');
      originalMeta = JSON.parse(originalMetaData);
    } catch {
      // No original metadata
    }

    // Create new version using the create endpoint logic
    const existingFiles = await fs.readdir(PROMPTS_DIR);
    const existingVersions = existingFiles
      .filter(f => f.startsWith(`prompt_${name}_v`))
      .map(f => {
        const match = f.match(/prompt_.*_v(\d+)_/);
        return match ? parseInt(match[1]) : 0;
      });
    const nextVersion = existingVersions.length > 0 ? Math.max(...existingVersions) + 1 : 1;

    const timestamp = getTimestamp();
    const promptFilename = `prompt_${name}_v${nextVersion}_${timestamp}.txt`;
    const promptPath = path.join(PROMPTS_DIR, promptFilename);
    await fs.writeFile(promptPath, content, 'utf-8');

    const metaPath = path.join(PROMPTS_DIR, `${promptFilename}.meta.json`);
    const metadata = {
      name,
      version: nextVersion,
      description: description || originalMeta.description || '',
      category: originalMeta.category || 'user',
      createdAt: new Date().toISOString(),
      visible: true,
      type: 'user',
      parentVersion: nextVersion - 1
    };
    await fs.writeFile(metaPath, JSON.stringify(metadata, null, 2), 'utf-8');

    console.log(`✓ Created new version: ${promptFilename}`);

    res.json({
      filename: promptFilename,
      content,
      version: nextVersion,
      metadata
    });
  } catch (error) {
    console.error('Error editing prompt:', error);
    res.status(500).json({ error: error.message || 'Failed to edit prompt' });
  }
});

// API: Delete/hide prompt
app.post('/api/prompts/delete', async (req, res) => {
  try {
    const { filename } = req.body;

    if (!filename) {
      return res.status(400).json({ error: 'Filename is required' });
    }

    // Load metadata
    const metaPath = path.join(PROMPTS_DIR, `${filename}.meta.json`);
    let metadata = {};

    try {
      const metaData = await fs.readFile(metaPath, 'utf-8');
      metadata = JSON.parse(metaData);
    } catch {
      // No metadata file, create one
      metadata = { visible: true };
    }

    // Set visible to false
    metadata.visible = false;
    metadata.deletedAt = new Date().toISOString();

    // Save updated metadata
    await fs.writeFile(metaPath, JSON.stringify(metadata, null, 2), 'utf-8');

    console.log(`✓ Hidden prompt: ${filename}`);

    res.json({ success: true, message: 'Prompt hidden successfully' });
  } catch (error) {
    console.error('Error deleting prompt:', error);
    res.status(500).json({ error: 'Failed to delete prompt' });
  }
});

// API: Run prompt with files (using saved prompt)
app.post('/api/run-saved-prompt', async (req, res) => {
  try {
    const { promptFilename, files, artifactName } = req.body;

    if (!promptFilename || !artifactName) {
      return res.status(400).json({ error: 'Prompt filename and artifact name are required' });
    }

    // Read prompt content
    const promptPath = path.join(PROMPTS_DIR, promptFilename);
    const promptContent = await fs.readFile(promptPath, 'utf-8');

    // Read file contents
    let contextText = '';
    if (files && files.length > 0) {
      const fileContents = await Promise.all(
        files.map(async (filename) => {
          const filePath = path.join(TRANSCRIPTIONS_DIR, filename);
          const content = await fs.readFile(filePath, 'utf-8');
          return `\n\n--- File: ${filename} ---\n\n${content}`;
        })
      );
      contextText = fileContents.join('\n\n');
    }

    // Determine next version number
    const existingFiles = await fs.readdir(TRANSCRIPTIONS_DIR);
    const existingVersions = existingFiles
      .filter(f => f.startsWith(`artifact_${artifactName}_v`))
      .map(f => {
        const match = f.match(/artifact_.*_v(\d+)_/);
        return match ? parseInt(match[1]) : 0;
      });
    const nextVersion = existingVersions.length > 0 ? Math.max(...existingVersions) + 1 : 1;

    // Call Claude
    const fullPrompt = `${promptContent}\n\n${contextText}`;
    const promptSize = Buffer.byteLength(fullPrompt, 'utf8');

    console.log(`\n🚀 Running saved prompt for artifact: ${artifactName} (v${nextVersion})`);
    console.log(`   📝 Prompt: ${promptFilename}`);
    console.log(`   📄 Prompt size: ${(promptSize / 1024).toFixed(2)} KB`);
    console.log(`   📎 Context files: ${files?.length || 0}`);

    const startTime = Date.now();
    const message = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: MAX_TOKENS_PROMPT,
      messages: [{
        role: 'user',
        content: fullPrompt
      }]
    });

    const duration = Date.now() - startTime;
    const outputTokens = message.usage?.output_tokens || 0;
    const inputTokens = message.usage?.input_tokens || 0;

    console.log(`✅ Prompt completed in ${(duration / 1000).toFixed(2)}s`);
    console.log(`   📊 Tokens - Input: ${inputTokens}, Output: ${outputTokens}\n`);

    const result = message.content[0].text;

    // Save artifact
    const timestamp = getTimestamp();
    const artifactFilename = `artifact_${artifactName}_v${nextVersion}_${timestamp}.md`;
    const artifactPath = path.join(TRANSCRIPTIONS_DIR, artifactFilename);
    await fs.writeFile(artifactPath, result, 'utf-8');

    // Save metadata
    const metaPath = path.join(TRANSCRIPTIONS_DIR, `${artifactFilename}.meta.json`);
    const metadata = {
      promptFile: promptFilename,
      prompt: promptContent,
      files: files || [],
      version: nextVersion,
      createdAt: new Date().toISOString(),
      model: CLAUDE_MODEL,
      type: 'prompt_artifact'
    };
    await fs.writeFile(metaPath, JSON.stringify(metadata, null, 2), 'utf-8');

    console.log(`✓ Created: ${artifactFilename}`);

    res.json({
      filename: artifactFilename,
      content: result,
      version: nextVersion,
      metadata
    });
  } catch (error) {
    console.error('Error running saved prompt:', error);
    res.status(500).json({ error: error.message || 'Failed to run saved prompt' });
  }
});

// Start server
async function startServer() {
  await ensureDirectories();
  await processRawTranscriptions();

  app.listen(PORT, () => {
    console.log(`\n🚀 Server running at http://localhost:${PORT}`);
    console.log(`📁 Transcriptions directory: ${TRANSCRIPTIONS_DIR}`);
    console.log(`📝 Prompts directory: ${PROMPTS_DIR}`);
    console.log(`🤖 Claude model: ${CLAUDE_MODEL}\n`);
  });
}

startServer();
