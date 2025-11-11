# Conversation Transcription Manager

A local web application for managing conversation transcriptions with Claude AI integration, featuring agentic workflows (LangGraph), RAG (Retrieval-Augmented Generation), and intelligent document processing.

## Features Overview

- 🤖 **Agentic Workflows**: Multi-step LangGraph flows with configurable nodes and edges
- 📚 **RAG Integration**: Semantic search across transcriptions with local embeddings
- 📝 **Smart Formatting**: Automatic transcription formatting with intelligent chunking
- 🔄 **Topic Management**: Interactive topic selection and filtering
- 📊 **LangSmith Tracing**: Optional distributed tracing for debugging and monitoring
- 💾 **Immutable Versioning**: All prompts and artifacts are versioned and preserved
- 🎯 **Flexible Agents**: Mix and match prompts and flows with custom configurations

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

Create a `.env` file from the example:

```bash
cp .env.example .env
```

Edit `.env` and add your Claude API key:

```env
CLAUDE_API_KEY=sk-ant-your-actual-key-here
TRANSCRIPTIONS_DIR=./transcriptions
PROMPTS_DIR=./prompts
PORT=3000
```

### 3. Create Directories

```bash
mkdir transcriptions prompts
```

### 4. Start the Application

```bash
npm start
```

### 5. Open Browser

Navigate to: `http://localhost:3000`

## Architecture

### Three-Panel Interface

#### Left Panel: File Browser
- **Click** to view a file
- **Ctrl+Click** to select files for prompt context
- Filter by type: All, Raw, Formatted, Artifacts
- **Format** button: Process raw transcriptions
- **Sync RAG** button: Index highlighted file to RAG

#### Middle Panel: Content Viewer
- View files in rendered markdown or raw text
- **Topic Selection** (for formatted documents): Select specific topics to include in context
- Toggle between Raw and Rendered views

#### Right Panel: Agent Interface
Two modes available:

**Saved Agents Mode:**
- Browse flows (🔄) and prompts (📝)
- View agent details and configuration
- Configure RAG retrieval options
- Select context files and topics
- Run agents to generate artifacts

**Custom Prompt Mode:**
- Write one-time custom prompts
- Configure RAG settings
- Save prompts for future reuse

## Core Concepts

### Agents

Agents are executable units that process transcriptions. There are two types:

#### 1. Prompts (📝)
Simple single-step LLM calls with a text prompt.

**Format:** `prompt_<name>_v<version>_YYYYMMDD_HHMMSS.txt`

**Example:**
```
Extract a comprehensive summary from the following conversation:

{context}

Provide:
1. Key discussion points
2. Decisions made
3. Action items
```

#### 2. Flows (🔄)
Multi-step LangGraph workflows with nodes and edges.

**Format:** `flow_<name>_v<version>_YYYYMMDD_HHMMSS.json`

**Example:**
```json
{
  "name": "comprehensive-analysis",
  "description": "Multi-step analysis workflow",
  "version": 1,
  "entryPoint": "extract",
  "nodes": [
    {
      "id": "extract",
      "type": "llm",
      "prompt": "Extract key points from: {input}",
      "output": "key_points"
    },
    {
      "id": "analyze",
      "type": "llm",
      "prompt": "Analyze these points: {key_points}",
      "output": "analysis"
    }
  ],
  "edges": [
    { "from": "extract", "to": "analyze" },
    { "from": "analyze", "to": "END" }
  ],
  "outputs": ["analysis"]
}
```

### RAG (Retrieval-Augmented Generation)

RAG enables semantic search across your transcriptions to automatically provide relevant context to agents.

**How it works:**
1. **Index**: Click "Sync RAG" to index a formatted document (creates embeddings)
2. **Retrieve**: When running an agent with RAG enabled, semantically similar chunks are retrieved
3. **Augment**: Retrieved context is prepended to your selected files
4. **Generate**: Agent processes both RAG context and file context

**RAG Features:**
- ✅ In-memory vector store (no persistence between restarts)
- ✅ Local embeddings using @xenova/transformers (no external API calls)
- ✅ Topic-aware chunking with metadata
- ✅ Configurable top-K results (3, 5, or 7)
- ✅ Optional custom query (or use artifact name)
- ✅ Auto-sync on startup (configurable)

**RAG Configuration:**
```env
RAG_ENABLED=true                              # Enable/disable RAG
RAG_TOP_K=3                                   # Number of results to retrieve
RAG_CHUNK_SIZE=1500                          # Chunk size in characters
RAG_CHUNK_OVERLAP=150                        # Overlap between chunks
RAG_AUTO_SYNC_ON_STARTUP=true                # Auto-sync formatted files
RAG_EMBEDDING_MODEL=Xenova/all-MiniLM-L6-v2  # Embedding model
```

### Topic Selection

Formatted documents with topics can be filtered in the viewer:

1. Click a formatted file to view it
2. Use the topic selector UI at the top
3. Check/uncheck specific topics
4. Click "Select All" or "Clear All" for bulk operations
5. Selected topics are included in prompt context

**Topic Format in Markdown:**
```markdown
## Topic: Introduction and Background
[id: intro-bg]

Content for this topic...

## Topic: Technical Discussion
[id: tech-discussion]

Content for this topic...
```

### File Naming Conventions

**Transcriptions & Artifacts:**
- Raw: `conversation_raw_YYYYMMDD_HHMMSS.txt`
- Formatted: `conversation_formatted_YYYYMMDD_HHMMSS.md`
- Artifacts: `artifact_<name>_v<version>_YYYYMMDD_HHMMSS.md`
- Metadata: `<filename>.meta.json`

**Agents:**
- Prompts: `prompt_<name>_v<version>_YYYYMMDD_HHMMSS.txt`
- Flows: `flow_<name>_v<version>_YYYYMMDD_HHMMSS.json`
- Metadata: `<filename>.meta.json`

**System Prompts:**
- Single-chunk: `system_format-single-chunk_v<version>_YYYYMMDD_HHMMSS.txt`
- Multi-chunk: `system_format-multi-chunk_v<version>_YYYYMMDD_HHMMSS.txt`

## Configuration

### Claude Model Selection

Choose the appropriate model for your needs:

```env
CLAUDE_MODEL=claude-sonnet-4-20250514
```

**Available Models:**
- `claude-3-5-haiku-20241022` - Fast, cost-effective (recommended for formatting)
- `claude-sonnet-4-5-20250514` - Latest, best quality
- `claude-sonnet-4-20250514` - Excellent quality
- `claude-3-5-sonnet-20241022` - Balanced performance
- `claude-3-opus-20240229` - Legacy, most capable

**Per-Node Model Override (Flows Only):**
```json
{
  "id": "analyze",
  "type": "llm",
  "model": "claude-sonnet-4-5-20250514",
  "prompt": "...",
  "output": "analysis"
}
```

### LangSmith Tracing

Enable distributed tracing for debugging workflows:

```env
LANGSMITH_TRACING=true
LANGSMITH_API_KEY=your-langsmith-api-key
LANGSMITH_PROJECT=conversation-manager
LANGSMITH_ENDPOINT=https://api.smith.langchain.com
```

Visit [smith.langchain.com](https://smith.langchain.com) to view traces.

### Intelligent Chunking

Large files are automatically split using smart boundary detection:

```env
CHUNK_SIZE=100000        # Target chunk size
OVERLAP_SIZE=1000        # Context overlap between chunks
DEBUG_WRITE_CHUNKS=false # Write debug files for each chunk
```

**Smart Splitting Priority:**
1. Paragraph breaks (double newlines)
2. Speaker changes (e.g., "Speaker:", "Person:")
3. Timestamp markers
4. Sentence endings
5. Single newlines

**Benefits:**
- No mid-sentence splits
- Preserved speaker turns and timestamps
- Natural conversation flow across chunks
- High formatting consistency

## Usage Guide

### Processing Transcriptions

1. **Add Raw File**: Place `conversation_raw_YYYYMMDD_HHMMSS.txt` in `transcriptions/`
2. **Format**: Click "Format" button or files are auto-processed on startup
3. **View**: Click the formatted file to view it
4. **Index to RAG** (optional): Click "Sync RAG" to enable semantic search

### Running Agents

#### Quick Run (Saved Agent)
1. **Select Agent**: Click an agent from the list (flow or prompt)
2. **Configure RAG**: Toggle RAG on/off, customize query if needed
3. **Select Context**: Ctrl+Click files in left panel (optional: select specific topics)
4. **Name Output**: Enter artifact name (e.g., "summary")
5. **Run**: Click "Run Agent"
6. **View Result**: New artifact appears in file list

#### Custom Prompt
1. **Switch Mode**: Click "Custom Prompt" tab
2. **Write Prompt**: Enter your prompt text
3. **Configure**: Set RAG options, select context files
4. **Name Output**: Enter artifact name
5. **Run or Save**: Click "Run Prompt" or "Save As..." to create reusable prompt

### Creating Flows

Create a JSON file in `prompts/` directory:

```json
{
  "name": "extract-and-summarize",
  "description": "Extract key points and create summary",
  "version": 1,
  "category": "analysis",
  "entryPoint": "extract",
  "nodes": [
    {
      "id": "extract",
      "type": "llm",
      "prompt": "Extract key discussion points from:\n\n{input}",
      "output": "key_points",
      "model": "claude-3-5-haiku-20241022",
      "temperature": 0,
      "maxTokens": 4096
    },
    {
      "id": "summarize",
      "type": "llm",
      "prompt": "Create a concise summary of:\n\n{key_points}",
      "output": "summary",
      "temperature": 0.3
    }
  ],
  "edges": [
    { "from": "extract", "to": "summarize" },
    { "from": "summarize", "to": "END" }
  ],
  "outputs": ["summary"]
}
```

**Node Configuration:**
- `id`: Unique node identifier
- `type`: "llm" (only type currently supported)
- `prompt`: Prompt text with variable interpolation
- `output`: State key to store result
- `model`: (Optional) Override default model
- `temperature`: (Optional) Override default temperature (0-1)
- `maxTokens`: (Optional) Override default max tokens

**Variable Interpolation:**
Use `{variable}` syntax to reference:
- `{input}`: Initial input context
- `{node_output}`: Output from previous nodes
- Any state variable from the workflow

### Managing Agents

**Creating Prompts:**
1. Click "New Prompt" or write in Custom Prompt mode
2. Enter name (alphanumeric and hyphens only)
3. Add description and category
4. Write prompt text (use `{context}` for file content)
5. Save

**Editing Prompts:**
1. Select prompt from list
2. Click "Edit"
3. Modify content/description
4. Save (creates new version: v2, v3, etc.)
5. Original remains immutable

**Deleting Agents:**
- Click "Delete" to hide from UI
- File remains on disk with `visible: false` in metadata
- Manually edit `.meta.json` to restore

**Editing Flows:**
- Manually edit JSON file in `prompts/` directory
- Increment version number
- Restart server to reload

## Prompt Template Variables

Use these variables in prompts and flows:

**File Context:**
- `{context}`: Combined content from selected files and topics

**RAG Context:**
- Automatically prepended when RAG is enabled
- Format: `[RAG Context N] (Source: file.md, Topic: title)\n<content>`

**Flow Variables:**
- `{input}`: Initial workflow input (file context)
- `{node_output}`: Reference any node's output by its `output` key

**Multi-Chunk System Prompts:**
- `{content}`: Current chunk content
- `{chunk_number}`: Current chunk number
- `{total_chunks}`: Total number of chunks
- `{overlap_before}`: Context from previous chunk
- `{overlap_after}`: Context from next chunk

## Advanced Features

### Metadata Files

Every file has an associated `.meta.json` file:

**Prompt Metadata:**
```json
{
  "name": "extract-summary",
  "description": "Extract comprehensive summary",
  "category": "analysis",
  "agentType": "prompt",
  "version": 1,
  "visible": true,
  "createdAt": "2025-01-10T12:00:00.000Z"
}
```

**Artifact Metadata:**
```json
{
  "sourcePrompt": "prompt_extract-summary_v1_20250110_120000.txt",
  "sourceFiles": ["conversation_formatted_20250110_120000.md"],
  "selectedTopics": {
    "conversation_formatted_20250110_120000.md": ["intro", "technical"]
  },
  "artifactName": "summary",
  "version": 1,
  "model": "claude-sonnet-4-20250514",
  "createdAt": "2025-01-10T12:30:00.000Z",
  "agentType": "prompt",
  "useRAG": true,
  "ragTopK": 3
}
```

### Custom System Prompts

Customize the automatic formatting behavior:

1. Create new system prompt files in `prompts/`
2. Update `.env`:
   ```env
   SYSTEM_PROMPT_SINGLE_CHUNK=my-custom-format
   SYSTEM_PROMPT_MULTI_CHUNK=my-custom-multi-format
   ```

**Template Example:**
```
Format this conversation transcript into structured markdown.

Content:
{content}

Requirements:
- Use ## for major sections
- Add topic IDs: [id: section-name]
- Preserve timestamps
- Clean up filler words
```

### Token Limits

Configure token limits per use case:

```env
MAX_TOKENS_TRANSCRIPTION=4096  # For automatic formatting
MAX_TOKENS_PROMPT=8192         # For prompts and flows
```

Per-node override (flows only):
```json
{
  "id": "analyze",
  "maxTokens": 16384
}
```

## Troubleshooting

### RAG Issues

**Embedding model not loading:**
- First run downloads ~100MB model
- Wait for "✅ Embedding model ready" message
- Check disk space and network connection

**No results from RAG:**
- Ensure files are synced: Click "Sync RAG" on formatted documents
- Verify RAG is enabled in `.env`
- Check server logs for errors

### Flow Issues

**Flow not appearing in UI:**
- Verify JSON syntax is valid
- Check file naming: `flow_<name>_v<version>_YYYYMMDD_HHMMSS.json`
- Restart server to reload flows
- Check metadata file has `visible: true`

**Flow execution errors:**
- View LangSmith traces if enabled
- Check server console for detailed errors
- Verify all node IDs are unique
- Ensure all referenced variables exist

### General Issues

**Files not appearing:**
- Check file naming conventions
- Refresh browser (click 🔄 button)
- Check transcriptions directory path in `.env`

**Formatting errors:**
- Check Claude API key is valid
- Verify model name in `.env`
- Check token limits are sufficient
- Review DEBUG_WRITE_CHUNKS output

## File Structure

```
conversation-manager/
├── .env                    # Configuration (create from .env.example)
├── .env.example           # Configuration template
├── server.js              # Backend server
├── package.json           # Dependencies
├── public/
│   ├── index.html        # Main UI
│   ├── app.js            # Frontend logic
│   ├── app-topics-addon.js  # Topic selection UI
│   └── styles.css        # Styles
├── transcriptions/        # Transcription files (create this)
│   ├── conversation_raw_*.txt
│   ├── conversation_formatted_*.md
│   ├── artifact_*.md
│   └── *.meta.json
└── prompts/               # Agent files (create this)
    ├── prompt_*.txt
    ├── flow_*.json
    ├── system_*.txt
    └── *.meta.json
```

## API Endpoints

The server exposes a REST API:

- `GET /api/files` - List all transcription files
- `GET /api/files/:filename` - Get file content and topics
- `GET /api/agents` - List all agents (prompts and flows)
- `GET /api/agents/:filename` - Get agent details
- `POST /api/format-transcriptions` - Format raw transcriptions
- `POST /api/prompt` - Run custom prompt
- `POST /api/run-agent` - Run saved agent (prompt or flow)
- `POST /api/prompts` - Create new prompt
- `POST /api/prompts/edit` - Edit prompt (create new version)
- `POST /api/prompts/delete` - Delete prompt (soft delete)
- `POST /api/rag/sync` - Sync files to RAG index
- `POST /api/rag/search` - Search RAG index

## Dependencies

**Backend:**
- `express` - Web server
- `@langchain/anthropic` - Claude AI integration
- `@langchain/langgraph` - Agentic workflows
- `@langchain/community` - Vector stores
- `@xenova/transformers` - Local embeddings
- `dotenv` - Environment configuration
- `cors` - CORS middleware

**Frontend:**
- `marked` - Markdown rendering

## License

MIT License - Use freely for personal and commercial projects.

## Contributing

This is a personal project, but suggestions and improvements are welcome via issues or pull requests.
