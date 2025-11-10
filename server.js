require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
const { ChatAnthropic } = require('@langchain/anthropic');
const { StateGraph, END } = require('@langchain/langgraph');

const app = express();
const PORT = process.env.PORT || 3000;
const TRANSCRIPTIONS_DIR = process.env.TRANSCRIPTIONS_DIR || './transcriptions';
const PROMPTS_DIR = process.env.PROMPTS_DIR || './prompts';
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-3-5-haiku-20241022';
const SYSTEM_PROMPT_SINGLE_CHUNK = process.env.SYSTEM_PROMPT_SINGLE_CHUNK || 'format-single-chunk';
const SYSTEM_PROMPT_MULTI_CHUNK = process.env.SYSTEM_PROMPT_MULTI_CHUNK || 'format-multi-chunk';
const CHUNK_SIZE = parseInt(process.env.CHUNK_SIZE || '100000');
const OVERLAP_SIZE = parseInt(process.env.OVERLAP_SIZE || '1000');
const REQUEST_SIZE_LIMIT = process.env.REQUEST_SIZE_LIMIT || '50mb';
const MAX_TOKENS_TRANSCRIPTION = parseInt(process.env.MAX_TOKENS_TRANSCRIPTION || '4096');
const MAX_TOKENS_PROMPT = parseInt(process.env.MAX_TOKENS_PROMPT || '8192');
const DEBUG_WRITE_CHUNKS = process.env.DEBUG_WRITE_CHUNKS === 'true';

// LangSmith Configuration
const LANGSMITH_TRACING = process.env.LANGSMITH_TRACING === 'true';
const LANGSMITH_API_KEY = process.env.LANGSMITH_API_KEY;
const LANGSMITH_PROJECT = process.env.LANGSMITH_PROJECT || 'interview-transcription-manager';
const LANGSMITH_ENDPOINT = process.env.LANGSMITH_ENDPOINT || 'https://api.smith.langchain.com';

// Configure LangSmith if enabled
if (LANGSMITH_TRACING) {
  if (!LANGSMITH_API_KEY) {
    console.warn('⚠️  LANGSMITH_TRACING is enabled but LANGSMITH_API_KEY is not set. Tracing will not work.');
  } else {
    process.env.LANGCHAIN_TRACING_V2 = 'true';
    process.env.LANGCHAIN_API_KEY = LANGSMITH_API_KEY;
    process.env.LANGCHAIN_PROJECT = LANGSMITH_PROJECT;
    process.env.LANGCHAIN_ENDPOINT = LANGSMITH_ENDPOINT;
    console.log(`📊 LangSmith tracing enabled for project: ${LANGSMITH_PROJECT}`);
  }
}

// Agent type constants
const FLOW_PREFIX = 'flow_';
const PROMPT_PREFIX = 'prompt_';

// RAG Configuration
const RAG_ENABLED = process.env.RAG_ENABLED !== 'false'; // Default to true
const RAG_TOP_K = parseInt(process.env.RAG_TOP_K || '3');
const RAG_CHUNK_SIZE = parseInt(process.env.RAG_CHUNK_SIZE || '1500');
const RAG_CHUNK_OVERLAP = parseInt(process.env.RAG_CHUNK_OVERLAP || '150');
const RAG_AUTO_SYNC_ON_STARTUP = process.env.RAG_AUTO_SYNC_ON_STARTUP !== 'false'; // Default to true
const RAG_EMBEDDING_MODEL = process.env.RAG_EMBEDDING_MODEL || 'Xenova/all-MiniLM-L6-v2';

// Global RAG state
let vectorStore = []; // Simple array-based vector store: { embedding, content, metadata }
let embedder = null;

// Initialize LangChain ChatAnthropic model
const llm = new ChatAnthropic({
  anthropicApiKey: process.env.CLAUDE_API_KEY,
  modelName: CLAUDE_MODEL,
  temperature: 0,
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

// Parse markdown content to extract topics by ## headers
function parseTopics(markdownContent) {
  const topics = [];
  const lines = markdownContent.split('\n');
  let currentTopic = null;
  let currentContent = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check if this is a ## header (level 2)
    if (line.startsWith('## ')) {
      // Save previous topic if exists
      if (currentTopic) {
        topics.push({
          ...currentTopic,
          content: currentContent.join('\n').trim()
        });
      }

      // Start new topic
      const title = line.substring(3).trim();
      currentTopic = {
        title,
        id: title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
        startLine: i + 1
      };
      currentContent = [line]; // Include the header in content
    } else if (currentTopic) {
      // Add line to current topic
      currentContent.push(line);
    } else {
      // Content before first topic (e.g., title, intro)
      if (!topics.length && line.trim()) {
        // Create a "preamble" topic for content before first ##
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

  // Save last topic
  if (currentTopic) {
    topics.push({
      ...currentTopic,
      content: currentContent.join('\n').trim()
    });
  }

  return topics;
}

// Split text into chunks at intelligent boundaries
function splitIntoChunks(text, targetChunkSize) {
  const chunks = [];
  const boundaryInfo = []; // Track where splits occurred
  let position = 0;

  console.log(`\n🔍 Starting intelligent chunking (target size: ${(targetChunkSize / 1024).toFixed(2)} KB)...`);

  while (position < text.length) {
    let chunkEnd = position + targetChunkSize;

    // Last chunk - take everything remaining
    if (chunkEnd >= text.length) {
      const finalChunk = text.slice(position);
      chunks.push(finalChunk);
      boundaryInfo.push({
        start: position,
        end: text.length,
        type: 'end',
        size: finalChunk.length
      });
      console.log(`   Final chunk: ${position} → ${text.length} (${(finalChunk.length / 1024).toFixed(2)} KB, type: end)`);
      break;
    }

    // Search for natural boundaries within window (±5000 chars from target)
    const windowSize = 5000;
    const searchStart = Math.max(position, chunkEnd - windowSize);
    const searchEnd = Math.min(chunkEnd + windowSize, text.length);
    const searchWindow = text.slice(searchStart, searchEnd);
    const windowOffset = searchStart;

    // Define boundary patterns in priority order
    const boundaries = [
      { pattern: /\n\n+/g, priority: 1, name: 'paragraph' },
      { pattern: /\n(?=[A-Z][a-z]*:)/g, priority: 2, name: 'speaker' },
      { pattern: /\n(?=\[\d{2}:\d{2})/g, priority: 3, name: 'timestamp' },
      { pattern: /[.!?]\s*\n/g, priority: 4, name: 'sentence' },
      { pattern: /\n/g, priority: 5, name: 'line' }
    ];

    let bestSplit = null;
    let bestPriority = Infinity;
    let bestBoundaryType = 'hard';

    // Find best boundary within each priority level
    for (const {pattern, priority, name} of boundaries) {
      const matches = [...searchWindow.matchAll(pattern)];
      if (matches.length > 0 && priority < bestPriority) {
        // Find match closest to target position
        const targetOffset = chunkEnd - windowOffset;
        const closest = matches.reduce((best, match) => {
          const distance = Math.abs(match.index - targetOffset);
          const bestDistance = Math.abs(best.index - targetOffset);
          return distance < bestDistance ? match : best;
        });

        bestSplit = windowOffset + closest.index + closest[0].length;
        bestPriority = priority;
        bestBoundaryType = name;
      }
    }

    // Use best split or fall back to hard boundary
    const actualEnd = bestSplit || chunkEnd;
    const chunkText = text.slice(position, actualEnd);

    // Verify we're not creating empty chunks
    if (chunkText.length === 0) {
      console.error(`⚠️  Error: Empty chunk detected at position ${position}`);
      break;
    }

    chunks.push(chunkText);

    boundaryInfo.push({
      start: position,
      end: actualEnd,
      type: bestBoundaryType,
      size: chunkText.length
    });

    console.log(`   Chunk ${chunks.length}: ${position} → ${actualEnd} (${(chunkText.length / 1024).toFixed(2)} KB, type: ${bestBoundaryType})`);

    position = actualEnd;
  }

  // Verify no data loss
  const totalChunkSize = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  if (totalChunkSize !== text.length) {
    console.error(`❌ DATA LOSS DETECTED: Original ${text.length} chars, chunks total ${totalChunkSize} chars`);
  } else {
    console.log(`✅ Chunking complete: ${chunks.length} chunks, ${text.length} chars preserved\n`);
  }

  return { chunks, boundaryInfo };
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

// ==== RAG HELPER FUNCTIONS ====

// Initialize embeddings model
async function initializeEmbedder() {
  if (!embedder && RAG_ENABLED) {
    console.log('🔄 Loading embedding model...');
    // Dynamic import for ES module
    const { pipeline } = await import('@xenova/transformers');
    embedder = await pipeline('feature-extraction', RAG_EMBEDDING_MODEL);
    console.log('✅ Embedding model ready');
  }
  return embedder;
}

// Helper: Compute cosine similarity between two vectors
function cosineSimilarity(vecA, vecB) {
  const dotProduct = vecA.reduce((sum, a, i) => sum + a * vecB[i], 0);
  const magA = Math.sqrt(vecA.reduce((sum, a) => sum + a * a, 0));
  const magB = Math.sqrt(vecB.reduce((sum, b) => sum + b * b, 0));
  return dotProduct / (magA * magB);
}

// Split text into chunks
function splitTextIntoChunks(text, chunkSize, overlap) {
  const chunks = [];
  let start = 0;

  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    chunks.push(text.slice(start, end));

    if (end >= text.length) break;
    start = end - overlap;
  }

  return chunks;
}

// Chunk document into smaller pieces for embedding
function chunkDocument(content, filename, chunkSize = RAG_CHUNK_SIZE, overlap = RAG_CHUNK_OVERLAP) {
  const chunks = [];
  const topics = parseTopics(content);

  // If topics exist, chunk by topic
  if (topics.length > 0) {
    topics.forEach(topic => {
      const topicChunks = splitTextIntoChunks(topic.content, chunkSize, overlap);
      topicChunks.forEach((chunk, idx) => {
        chunks.push({
          content: chunk,
          metadata: {
            source: filename,
            topic: topic.title,
            topicId: topic.id,
            chunkIndex: idx
          }
        });
      });
    });
  } else {
    // No topics, chunk entire document
    const textChunks = splitTextIntoChunks(content, chunkSize, overlap);
    textChunks.forEach((chunk, idx) => {
      chunks.push({
        content: chunk,
        metadata: {
          source: filename,
          chunkIndex: idx
        }
      });
    });
  }

  return chunks;
}

// Sync files to RAG index
async function syncFilesToRAG(filenames) {
  if (!RAG_ENABLED) {
    return { success: false, message: 'RAG is disabled' };
  }

  await initializeEmbedder();

  let syncedCount = 0;
  let totalChunks = 0;

  for (const filename of filenames) {
    try {
      const filePath = path.join(TRANSCRIPTIONS_DIR, filename);
      const content = await fs.readFile(filePath, 'utf-8');

      const chunks = chunkDocument(content, filename);

      // Generate embeddings for each chunk and add to vector store
      for (const chunk of chunks) {
        const result = await embedder(chunk.content, { pooling: 'mean', normalize: true });
        const embedding = Array.from(result.data);

        vectorStore.push({
          embedding,
          content: chunk.content,
          metadata: chunk.metadata
        });
      }

      totalChunks += chunks.length;
      syncedCount++;

      console.log(`  ✓ Indexed: ${filename} (${chunks.length} chunks)`);
    } catch (error) {
      console.error(`  ✗ Failed to index ${filename}:`, error.message);
    }
  }

  console.log(`\n📊 RAG Index: ${totalChunks} chunks from ${syncedCount} files\n`);

  return {
    success: true,
    filesIndexed: syncedCount,
    totalChunks: totalChunks
  };
}

// Search RAG index
async function searchRAG(query, topK = RAG_TOP_K) {
  if (!vectorStore || vectorStore.length === 0) {
    return [];
  }

  // Generate query embedding
  const queryResult = await embedder(query, { pooling: 'mean', normalize: true });
  const queryEmbedding = Array.from(queryResult.data);

  // Calculate similarity scores for all documents
  const scored = vectorStore.map(doc => ({
    ...doc,
    score: cosineSimilarity(queryEmbedding, doc.embedding)
  }));

  // Sort by score descending and take top K
  scored.sort((a, b) => b.score - a.score);
  const topResults = scored.slice(0, topK);

  return topResults.map(doc => ({
    content: doc.content,
    metadata: doc.metadata,
    score: doc.score
  }));
}

// Parse agent filename (flow or prompt)
function parseAgentFilename(filename) {
  const parts = filename.split('_');

  // Check if it's a flow file
  if (filename.startsWith(FLOW_PREFIX) && filename.endsWith('.json')) {
    const name = parts[1];
    const versionPart = parts[2];
    const version = versionPart ? parseInt(versionPart.replace('v', '')) : null;
    const timestamp = parts.slice(3).join('_').replace('.json', '');

    return {
      type: 'file',
      agentType: 'flow',
      name,
      version,
      timestamp
    };
  }

  // Check if it's a prompt file
  if (filename.startsWith(PROMPT_PREFIX) && filename.endsWith('.txt')) {
    const name = parts[1];
    const versionPart = parts[2];
    const version = versionPart ? parseInt(versionPart.replace('v', '')) : null;
    const timestamp = parts.slice(3).join('_').replace('.txt', '');

    return {
      type: 'file',
      agentType: 'prompt',
      name,
      version,
      timestamp
    };
  }

  return null;
}

// Load flow definition from JSON file
async function loadFlowDefinition(filename) {
  try {
    const filePath = path.join(PROMPTS_DIR, filename);
    const content = await fs.readFile(filePath, 'utf-8');
    const flowDef = JSON.parse(content);
    return flowDef;
  } catch (error) {
    console.error(`Error loading flow definition ${filename}:`, error.message);
    throw error;
  }
}

// Build LangGraph from flow definition
async function buildLangGraph(flowDef, inputContext) {
  const workflow = new StateGraph({
    channels: {
      input: { value: (x, y) => (y !== undefined ? y : x) },
      ...Object.fromEntries(
        flowDef.nodes.map(node => [
          node.output,
          { value: (x, y) => (y !== undefined ? y : x) }
        ])
      )
    }
  });

  // Add nodes
  for (const node of flowDef.nodes) {
    if (node.type === 'llm') {
      workflow.addNode(node.id, async (state) => {
        console.log(`  🔄 Executing node: ${node.id}`);

        // Fill prompt template with current state
        const filledPrompt = fillPromptTemplate(node.prompt, state);

        // Create node-specific LLM with custom config
        const nodeLlm = new ChatAnthropic({
          anthropicApiKey: process.env.CLAUDE_API_KEY,
          modelName: node.model || CLAUDE_MODEL,
          temperature: node.temperature !== undefined ? node.temperature : 0,
        });

        // Execute LLM call
        const startTime = Date.now();
        const response = await nodeLlm.invoke(filledPrompt, {
          maxTokens: node.maxTokens || MAX_TOKENS_PROMPT
        });
        const duration = ((Date.now() - startTime) / 1000).toFixed(2);

        const outputTokens = response.response_metadata?.usage?.output_tokens || 0;
        const inputTokens = response.response_metadata?.usage?.input_tokens || 0;

        console.log(`  ✅ Node ${node.id} completed in ${duration}s`);
        console.log(`     📊 Tokens - Input: ${inputTokens}, Output: ${outputTokens}`);

        // Return new state with this node's output
        return {
          [node.output]: response.content
        };
      });
    }
  }

  // Add edges
  for (const edge of flowDef.edges) {
    if (edge.to === 'END') {
      workflow.addEdge(edge.from, END);
    } else {
      workflow.addEdge(edge.from, edge.to);
    }
  }

  // Set entry point
  workflow.setEntryPoint(flowDef.entryPoint);

  return workflow.compile();
}

// Execute flow with input context
async function executeFlow(flowDef, inputContext) {
  console.log(`\n🤖 Executing flow: ${flowDef.name}`);
  console.log(`   📝 Nodes: ${flowDef.nodes.length}`);
  console.log(`   🔗 Edges: ${flowDef.edges.length}`);

  const startTime = Date.now();

  // Build and compile the graph
  const graph = await buildLangGraph(flowDef, inputContext);

  // Execute the graph with initial state
  const result = await graph.invoke({
    input: inputContext
  });

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`\n✅ Flow completed in ${duration}s`);

  // Extract outputs as specified in flow definition
  const outputs = {};
  for (const outputKey of flowDef.outputs) {
    outputs[outputKey] = result[outputKey];
  }

  return {
    outputs,
    duration
  };
}

// Format transcription using Claude with prompts from files
async function formatTranscription(rawText) {
  const startTime = Date.now();
  const { chunks, boundaryInfo } = splitIntoChunks(rawText, CHUNK_SIZE);
  const formattedChunks = [];

  const documentSize = Buffer.byteLength(rawText, 'utf8');
  console.log(`📄 Document size: ${(documentSize / 1024).toFixed(2)} KB`);
  console.log(`📦 Formatting transcription in ${chunks.length} chunk(s)...`);

  // Log boundary information
  if (chunks.length > 1) {
    console.log(`\n📍 Chunk boundaries:`);
    boundaryInfo.forEach((info, idx) => {
      console.log(`   Chunk ${idx + 1}: ${(info.size / 1024).toFixed(2)} KB, split type: ${info.type}`);
    });
  }

  // Load appropriate prompt template based on chunk count
  const promptName = chunks.length > 1 ? SYSTEM_PROMPT_MULTI_CHUNK : SYSTEM_PROMPT_SINGLE_CHUNK;
  const promptTemplate = await loadSystemPrompt(promptName);

  for (let i = 0; i < chunks.length; i++) {
    const chunkStartTime = Date.now();
    const chunkSize = Buffer.byteLength(chunks[i], 'utf8');
    console.log(`\n🔄 Processing chunk ${i + 1}/${chunks.length} (${(chunkSize / 1024).toFixed(2)} KB)...`);

    // Extract overlap context from adjacent chunks
    let overlapBefore = '';
    let overlapAfter = '';

    if (chunks.length > 1) {
      // Get last OVERLAP_SIZE chars from previous chunk
      if (i > 0) {
        const prevChunk = chunks[i - 1];
        overlapBefore = prevChunk.slice(-OVERLAP_SIZE);
      }

      // Get first OVERLAP_SIZE chars from next chunk
      if (i < chunks.length - 1) {
        const nextChunk = chunks[i + 1];
        overlapAfter = nextChunk.slice(0, OVERLAP_SIZE);
      }
    }

    // Fill in the template with actual values
    const prompt = chunks.length > 1
      ? fillPromptTemplate(promptTemplate, {
          chunk_number: (i + 1).toString(),
          total_chunks: chunks.length.toString(),
          overlap_before: overlapBefore,
          content: chunks[i],
          overlap_after: overlapAfter
        })
      : fillPromptTemplate(promptTemplate, {
          content: chunks[i]
        });

    try {
      const apiStartTime = Date.now();

      // Use LangChain to invoke the model
      const response = await llm.invoke(prompt, {
        maxTokens: MAX_TOKENS_TRANSCRIPTION
      });

      const apiDuration = Date.now() - apiStartTime;

      // Extract token usage from response metadata
      const outputTokens = response.response_metadata?.usage?.output_tokens || 0;
      const inputTokens = response.response_metadata?.usage?.input_tokens || 0;

      const formattedText = response.content;
      formattedChunks.push(formattedText);

      const chunkDuration = Date.now() - chunkStartTime;
      console.log(`✅ Chunk ${i + 1} completed in ${(chunkDuration / 1000).toFixed(2)}s (API: ${(apiDuration / 1000).toFixed(2)}s)`);
      console.log(`   📊 Tokens - Input: ${inputTokens}, Output: ${outputTokens}`);

      // Write debug files immediately after formatting if enabled
      if (DEBUG_WRITE_CHUNKS) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
        const originalChunkPath = path.join(TRANSCRIPTIONS_DIR, `debug_chunk_${i + 1}_original_${timestamp}.txt`);
        const formattedChunkPath = path.join(TRANSCRIPTIONS_DIR, `debug_chunk_${i + 1}_formatted_${timestamp}.txt`);

        try {
          await fs.writeFile(originalChunkPath, chunks[i], 'utf8');
          await fs.writeFile(formattedChunkPath, formattedText, 'utf8');
          console.log(`   📝 Written debug files: debug_chunk_${i + 1}_*.txt`);
        } catch (writeError) {
          console.error(`   ❌ Error writing chunk ${i + 1} debug files:`, writeError.message);
        }
      }

      // Log size comparison
      const originalSize = Buffer.byteLength(chunks[i], 'utf8');
      const formattedSize = Buffer.byteLength(formattedText, 'utf8');
      console.log(`   📏 Size: ${(originalSize / 1024).toFixed(2)} KB → ${(formattedSize / 1024).toFixed(2)} KB`);

    } catch (error) {
      const chunkDuration = Date.now() - chunkStartTime;
      console.error(`❌ Error formatting chunk ${i + 1} after ${(chunkDuration / 1000).toFixed(2)}s:`, error.message);
      const errorText = `\n\n## Chunk ${i + 1} (Error formatting)\n\n${chunks[i]}\n\n`;
      formattedChunks.push(errorText);

      // Write debug files even for errors
      if (DEBUG_WRITE_CHUNKS) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
        const originalChunkPath = path.join(TRANSCRIPTIONS_DIR, `debug_chunk_${i + 1}_original_${timestamp}.txt`);
        const errorChunkPath = path.join(TRANSCRIPTIONS_DIR, `debug_chunk_${i + 1}_ERROR_${timestamp}.txt`);

        try {
          await fs.writeFile(originalChunkPath, chunks[i], 'utf8');
          await fs.writeFile(errorChunkPath, errorText, 'utf8');
          console.log(`   📝 Written debug files (with error): debug_chunk_${i + 1}_*.txt`);
        } catch (writeError) {
          console.error(`   ❌ Error writing error chunk ${i + 1} debug files:`, writeError.message);
        }
      }
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

// API: Get topics from a formatted interview
app.get('/api/files/:filename/topics', async (req, res) => {
  try {
    const { filename } = req.params;

    // Only allow formatted interviews and artifacts (markdown files)
    if (!filename.endsWith('.md')) {
      return res.status(400).json({ error: 'Topics can only be extracted from markdown files' });
    }

    const filePath = path.join(TRANSCRIPTIONS_DIR, filename);
    const content = await fs.readFile(filePath, 'utf-8');
    const topics = parseTopics(content);

    res.json({ topics });
  } catch (error) {
    console.error('Error extracting topics:', error);
    res.status(500).json({ error: 'Failed to extract topics' });
  }
});

// API: Run prompt with files
app.post('/api/prompt', async (req, res) => {
  try {
    const { prompt, files, artifactName } = req.body;

    if (!prompt || !artifactName) {
      return res.status(400).json({ error: 'Prompt and artifact name are required' });
    }

    // Read file contents with optional topic selection
    let contextText = '';
    if (files && files.length > 0) {
      const fileContents = await Promise.all(
        files.map(async (fileSpec) => {
          // Support both string filename and object with topicIds
          const filename = typeof fileSpec === 'string' ? fileSpec : fileSpec.file;
          const topicIds = typeof fileSpec === 'object' ? fileSpec.topicIds : null;

          const filePath = path.join(TRANSCRIPTIONS_DIR, filename);
          const content = await fs.readFile(filePath, 'utf-8');

          // If topics are specified and this is a markdown file, extract only those topics
          if (topicIds && topicIds.length > 0 && filename.endsWith('.md')) {
            const topics = parseTopics(content);
            const selectedTopics = topics.filter(t => topicIds.includes(t.id));

            if (selectedTopics.length > 0) {
              const topicContent = selectedTopics.map(t => t.content).join('\n\n');
              const topicNames = selectedTopics.map(t => t.title).join(', ');
              return `\n\n--- File: ${filename} (Topics: ${topicNames}) ---\n\n${topicContent}`;
            } else {
              // If no topics matched, fall back to full file
              return `\n\n--- File: ${filename} ---\n\n${content}`;
            }
          } else {
            // Use full file content
            return `\n\n--- File: ${filename} ---\n\n${content}`;
          }
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

    // Use LangChain to invoke the model
    const response = await llm.invoke(fullPrompt, {
      maxTokens: MAX_TOKENS_PROMPT
    });

    const duration = Date.now() - startTime;
    const outputTokens = response.response_metadata?.usage?.output_tokens || 0;
    const inputTokens = response.response_metadata?.usage?.input_tokens || 0;

    console.log(`✅ Prompt completed in ${(duration / 1000).toFixed(2)}s`);
    console.log(`   📊 Tokens - Input: ${inputTokens}, Output: ${outputTokens}\n`);

    const result = response.content;

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
// API: List all agents (flows and prompts)
app.get('/api/agents', async (req, res) => {
  try {
    const files = await fs.readdir(PROMPTS_DIR);

    // Get flow files (exclude .meta.json files)
    const flowFiles = files.filter(f => f.startsWith(FLOW_PREFIX) && f.endsWith('.json') && !f.endsWith('.meta.json'));

    // Get prompt files
    const promptFiles = files.filter(f => f.startsWith(PROMPT_PREFIX) && f.endsWith('.txt'));

    // Process flows
    const flows = await Promise.all(
      flowFiles.map(async (filename) => {
        const filePath = path.join(PROMPTS_DIR, filename);
        const stats = await fs.stat(filePath);
        const metadata = parseAgentFilename(filename);

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

        // Only return visible flows
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

    // Process prompts
    const prompts = await Promise.all(
      promptFiles.map(async (filename) => {
        const filePath = path.join(PROMPTS_DIR, filename);
        const stats = await fs.stat(filePath);
        const metadata = parseAgentFilename(filename);

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

    // Combine and filter out null values (hidden agents)
    const allAgents = [...flows, ...prompts]
      .filter(a => a !== null)
      .sort((a, b) => {
        // Sort flows before prompts
        if (a.agentType !== b.agentType) {
          return a.agentType === 'flow' ? -1 : 1;
        }
        // Then sort by name
        if (a.name !== b.name) {
          return a.name.localeCompare(b.name);
        }
        // Then by version (descending)
        return (b.version || 0) - (a.version || 0);
      });

    res.json(allAgents);
  } catch (error) {
    console.error('Error listing agents:', error);
    res.status(500).json({ error: 'Failed to list agents' });
  }
});

// Backward compatibility: /api/prompts still works
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

// API: Get agent content (flow or prompt)
app.get('/api/agents/:filename', async (req, res) => {
  try {
    const { filename } = req.params;
    const filePath = path.join(PROMPTS_DIR, filename);
    const agentInfo = parseAgentFilename(filename);

    if (!agentInfo) {
      return res.status(400).json({ error: 'Invalid agent filename' });
    }

    // Load content based on agent type
    let content;
    if (agentInfo.agentType === 'flow') {
      // For flows, parse JSON
      const flowContent = await fs.readFile(filePath, 'utf-8');
      content = JSON.parse(flowContent);
    } else {
      // For prompts, return as text
      content = await fs.readFile(filePath, 'utf-8');
    }

    // Load metadata
    let metaContent = null;
    try {
      const metaPath = path.join(PROMPTS_DIR, `${filename}.meta.json`);
      const metaData = await fs.readFile(metaPath, 'utf-8');
      metaContent = JSON.parse(metaData);
    } catch {
      metaContent = { visible: true };
    }

    res.json({
      content,
      metadata: metaContent,
      agentType: agentInfo.agentType
    });
  } catch (error) {
    console.error('Error reading agent:', error);
    res.status(500).json({ error: 'Failed to read agent' });
  }
});

// Backward compatibility: Get prompt content
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
// API: Run agent (flow or prompt)
app.post('/api/run-agent', async (req, res) => {
  try {
    const { agentFilename, files, artifactName } = req.body;

    if (!agentFilename || !artifactName) {
      return res.status(400).json({ error: 'Agent filename and artifact name are required' });
    }

    // Determine agent type
    const agentInfo = parseAgentFilename(agentFilename);
    if (!agentInfo) {
      return res.status(400).json({ error: 'Invalid agent filename' });
    }

    // Read file contents with optional topic selection (common for both agent types)
    let contextText = '';
    if (files && files.length > 0) {
      const fileContents = await Promise.all(
        files.map(async (fileSpec) => {
          const filename = typeof fileSpec === 'string' ? fileSpec : fileSpec.file;
          const topicIds = typeof fileSpec === 'object' ? fileSpec.topicIds : null;

          const filePath = path.join(TRANSCRIPTIONS_DIR, filename);
          const content = await fs.readFile(filePath, 'utf-8');

          if (topicIds && topicIds.length > 0 && filename.endsWith('.md')) {
            const topics = parseTopics(content);
            const selectedTopics = topics.filter(t => topicIds.includes(t.id));

            if (selectedTopics.length > 0) {
              const topicContent = selectedTopics.map(t => t.content).join('\n\n');
              const topicNames = selectedTopics.map(t => t.title).join(', ');
              return `\n\n--- File: ${filename} (Topics: ${topicNames}) ---\n\n${topicContent}`;
            }
          }

          return `\n\n--- File: ${filename} ---\n\n${content}`;
        })
      );
      contextText = fileContents.join('\n\n');
    }

    // Add RAG retrieval if enabled
    if (req.body.useRAG && RAG_ENABLED && vectorStore) {
      const ragQuery = req.body.ragQuery || artifactName;
      const ragTopK = req.body.ragTopK || RAG_TOP_K;

      console.log(`   🔍 RAG Query: "${ragQuery}"`);

      const ragResults = await searchRAG(ragQuery, ragTopK);

      if (ragResults.length > 0) {
        const ragContext = ragResults.map((r, idx) =>
          `[RAG Context ${idx + 1}] (Source: ${r.metadata.source}${r.metadata.topic ? `, Topic: ${r.metadata.topic}` : ''})\n${r.content}`
        ).join('\n\n---\n\n');

        // Prepend RAG context to existing context
        contextText = ragContext + (contextText ? `\n\n--- Selected Files Context ---\n\n${contextText}` : '');

        console.log(`   📚 Retrieved ${ragResults.length} RAG chunks`);
      } else {
        console.log(`   ℹ️  No RAG results found`);
      }
    }

    // Determine next version number for artifact
    const existingFiles = await fs.readdir(TRANSCRIPTIONS_DIR);
    const existingVersions = existingFiles
      .filter(f => f.startsWith(`artifact_${artifactName}_v`))
      .map(f => {
        const match = f.match(/artifact_.*_v(\d+)_/);
        return match ? parseInt(match[1]) : 0;
      });
    const nextVersion = existingVersions.length > 0 ? Math.max(...existingVersions) + 1 : 1;

    let result;
    let agentMetadata = {};

    // Execute based on agent type
    if (agentInfo.agentType === 'flow') {
      // Execute flow
      const flowDef = await loadFlowDefinition(agentFilename);

      console.log(`\n🤖 Running flow for artifact: ${artifactName} (v${nextVersion})`);
      console.log(`   🔄 Flow: ${agentFilename}`);
      console.log(`   📎 Context files: ${files?.length || 0}`);

      const flowResult = await executeFlow(flowDef, contextText);

      // Combine all outputs into result
      result = Object.entries(flowResult.outputs)
        .map(([key, value]) => `## ${key}\n\n${value}`)
        .join('\n\n');

      agentMetadata = {
        agentFile: agentFilename,
        agentType: 'flow',
        flowDefinition: flowDef.name,
        files: files || [],
        version: nextVersion,
        createdAt: new Date().toISOString(),
        type: 'flow_artifact',
        duration: flowResult.duration
      };

    } else {
      // Execute prompt
      const promptPath = path.join(PROMPTS_DIR, agentFilename);
      const promptContent = await fs.readFile(promptPath, 'utf-8');

      const fullPrompt = `${promptContent}\n\n${contextText}`;
      const promptSize = Buffer.byteLength(fullPrompt, 'utf8');

      console.log(`\n📝 Running prompt for artifact: ${artifactName} (v${nextVersion})`);
      console.log(`   📝 Prompt: ${agentFilename}`);
      console.log(`   📄 Prompt size: ${(promptSize / 1024).toFixed(2)} KB`);
      console.log(`   📎 Context files: ${files?.length || 0}`);

      const startTime = Date.now();
      const response = await llm.invoke(fullPrompt, {
        maxTokens: MAX_TOKENS_PROMPT
      });

      const duration = Date.now() - startTime;
      const outputTokens = response.response_metadata?.usage?.output_tokens || 0;
      const inputTokens = response.response_metadata?.usage?.input_tokens || 0;

      console.log(`✅ Prompt completed in ${(duration / 1000).toFixed(2)}s`);
      console.log(`   📊 Tokens - Input: ${inputTokens}, Output: ${outputTokens}\n`);

      result = response.content;

      agentMetadata = {
        agentFile: agentFilename,
        agentType: 'prompt',
        prompt: promptContent,
        files: files || [],
        version: nextVersion,
        createdAt: new Date().toISOString(),
        model: CLAUDE_MODEL,
        type: 'prompt_artifact'
      };
    }

    // Save artifact
    const timestamp = getTimestamp();
    const artifactFilename = `artifact_${artifactName}_v${nextVersion}_${timestamp}.md`;
    const artifactPath = path.join(TRANSCRIPTIONS_DIR, artifactFilename);
    await fs.writeFile(artifactPath, result, 'utf-8');

    // Save metadata
    const metaPath = path.join(TRANSCRIPTIONS_DIR, `${artifactFilename}.meta.json`);
    await fs.writeFile(metaPath, JSON.stringify(agentMetadata, null, 2), 'utf-8');

    console.log(`✓ Created: ${artifactFilename}`);

    res.json({
      filename: artifactFilename,
      content: result,
      version: nextVersion,
      metadata: agentMetadata
    });

  } catch (error) {
    console.error('Error running agent:', error);
    res.status(500).json({ error: error.message || 'Failed to run agent' });
  }
});

// Backward compatibility: Run saved prompt
app.post('/api/run-saved-prompt', async (req, res) => {
  try {
    const { promptFilename, files, artifactName } = req.body;

    if (!promptFilename || !artifactName) {
      return res.status(400).json({ error: 'Prompt filename and artifact name are required' });
    }

    // Read prompt content
    const promptPath = path.join(PROMPTS_DIR, promptFilename);
    const promptContent = await fs.readFile(promptPath, 'utf-8');

    // Read file contents with optional topic selection
    let contextText = '';
    if (files && files.length > 0) {
      const fileContents = await Promise.all(
        files.map(async (fileSpec) => {
          // Support both string filename and object with topicIds
          const filename = typeof fileSpec === 'string' ? fileSpec : fileSpec.file;
          const topicIds = typeof fileSpec === 'object' ? fileSpec.topicIds : null;

          const filePath = path.join(TRANSCRIPTIONS_DIR, filename);
          const content = await fs.readFile(filePath, 'utf-8');

          // If topics are specified and this is a markdown file, extract only those topics
          if (topicIds && topicIds.length > 0 && filename.endsWith('.md')) {
            const topics = parseTopics(content);
            const selectedTopics = topics.filter(t => topicIds.includes(t.id));

            if (selectedTopics.length > 0) {
              const topicContent = selectedTopics.map(t => t.content).join('\n\n');
              const topicNames = selectedTopics.map(t => t.title).join(', ');
              return `\n\n--- File: ${filename} (Topics: ${topicNames}) ---\n\n${topicContent}`;
            } else {
              // If no topics matched, fall back to full file
              return `\n\n--- File: ${filename} ---\n\n${content}`;
            }
          } else {
            // Use full file content
            return `\n\n--- File: ${filename} ---\n\n${content}`;
          }
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

    // Use LangChain to invoke the model
    const response = await llm.invoke(fullPrompt, {
      maxTokens: MAX_TOKENS_PROMPT
    });

    const duration = Date.now() - startTime;
    const outputTokens = response.response_metadata?.usage?.output_tokens || 0;
    const inputTokens = response.response_metadata?.usage?.input_tokens || 0;

    console.log(`✅ Prompt completed in ${(duration / 1000).toFixed(2)}s`);
    console.log(`   📊 Tokens - Input: ${inputTokens}, Output: ${outputTokens}\n`);

    const result = response.content;

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

// API: Manually trigger formatting of raw transcriptions
app.post('/api/format-transcriptions', async (req, res) => {
  try {
    const startTime = Date.now();
    const files = await fs.readdir(TRANSCRIPTIONS_DIR);
    const rawFiles = files.filter(f => f.startsWith('interview_raw_') && f.endsWith('.txt'));

    if (rawFiles.length === 0) {
      return res.json({
        message: 'No raw transcriptions found to process',
        processed: 0,
        skipped: 0
      });
    }

    console.log(`\n📋 Found ${rawFiles.length} raw transcription(s) to check...`);

    let processedCount = 0;
    let skippedCount = 0;
    const results = [];

    for (const rawFile of rawFiles) {
      const { timestamp } = parseFilename(rawFile);
      const formattedFile = `interview_formatted_${timestamp}.md`;
      const formattedPath = path.join(TRANSCRIPTIONS_DIR, formattedFile);

      // Check if formatted version already exists
      try {
        await fs.access(formattedPath);
        console.log(`   ✓ Already formatted: ${rawFile}`);
        skippedCount++;
        results.push({ file: rawFile, status: 'skipped', reason: 'Already formatted' });
        continue;
      } catch {
        // File doesn't exist, proceed with formatting
      }

      console.log(`\n📝 Formatting new transcription: ${rawFile}`);
      const fileStartTime = Date.now();
      const rawPath = path.join(TRANSCRIPTIONS_DIR, rawFile);
      const rawText = await fs.readFile(rawPath, 'utf-8');

      try {
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
        results.push({
          file: rawFile,
          status: 'success',
          output: formattedFile,
          duration: fileDuration
        });
      } catch (error) {
        console.error(`❌ Error formatting ${rawFile}:`, error.message);
        results.push({
          file: rawFile,
          status: 'error',
          error: error.message
        });
      }
    }

    const totalDuration = Date.now() - startTime;
    console.log(`\n📊 Transcription processing complete:`);
    console.log(`   ✅ Formatted: ${processedCount}`);
    console.log(`   ⏭️  Skipped: ${skippedCount}`);
    console.log(`   ⏱️  Total time: ${(totalDuration / 1000).toFixed(2)}s\n`);

    res.json({
      message: 'Formatting complete',
      processed: processedCount,
      skipped: skippedCount,
      totalDuration,
      results
    });
  } catch (error) {
    console.error('❌ Error processing raw transcriptions:', error);
    res.status(500).json({ error: error.message || 'Failed to process transcriptions' });
  }
});

// ===== RAG APIs =====

// API: Sync files to RAG index
app.post('/api/rag/sync', async (req, res) => {
  try {
    const { files } = req.body;

    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'No files specified' });
    }

    console.log(`\n🔄 Syncing ${files.length} files to RAG index...`);
    const result = await syncFilesToRAG(files);

    res.json(result);
  } catch (error) {
    console.error('Error syncing to RAG:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: Search RAG index
app.post('/api/rag/search', async (req, res) => {
  try {
    const { query, topK = RAG_TOP_K } = req.body;

    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }

    const results = await searchRAG(query, topK);
    res.json({ results });
  } catch (error) {
    console.error('Error searching RAG:', error);
    res.status(500).json({ error: error.message });
  }
});

// Start server
async function startServer() {
  await ensureDirectories();

  // Auto-sync RAG on startup if enabled
  if (RAG_ENABLED && RAG_AUTO_SYNC_ON_STARTUP) {
    try {
      const files = await fs.readdir(TRANSCRIPTIONS_DIR);
      const formattedFiles = files.filter(f => f.startsWith('interview_formatted_') && f.endsWith('.md'));

      if (formattedFiles.length > 0) {
        console.log(`\n🔄 Auto-syncing ${formattedFiles.length} formatted files to RAG...`);
        await syncFilesToRAG(formattedFiles);
      }
    } catch (error) {
      console.error('Error during RAG auto-sync:', error);
    }
  }

  app.listen(PORT, () => {
    console.log(`\n🚀 Server running at http://localhost:${PORT}`);
    console.log(`📁 Transcriptions directory: ${TRANSCRIPTIONS_DIR}`);
    console.log(`📝 Prompts directory: ${PROMPTS_DIR}`);
    console.log(`🤖 Claude model: ${CLAUDE_MODEL}`);

    if (LANGSMITH_TRACING && LANGSMITH_API_KEY) {
      console.log(`📊 LangSmith tracing: enabled (project: ${LANGSMITH_PROJECT})`);
    } else {
      console.log(`📊 LangSmith tracing: disabled`);
    }

    if (RAG_ENABLED) {
      console.log(`📚 RAG: enabled (in-memory vector store, ${RAG_AUTO_SYNC_ON_STARTUP ? 'auto-sync on' : 'manual sync'})`);
    } else {
      console.log(`📚 RAG: disabled`);
    }

    console.log(`\nℹ️  Raw transcriptions will not be formatted automatically.`);
    console.log(`   Use the "Format Transcriptions" button in the UI to process them.\n`);
  });
}

startServer();
