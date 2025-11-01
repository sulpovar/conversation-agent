# Interview Transcription Manager

A local web application for managing job interview transcriptions with Claude AI integration.

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Create a `.env` file from the example:
   ```bash
   cp .env.example .env
   ```

3. Edit `.env` and add your Claude API key:
   ```
   CLAUDE_API_KEY=sk-ant-your-actual-key-here
   TRANSCRIPTIONS_DIR=./transcriptions
   PORT=3000
   ```

4. Create the transcriptions directory:
   ```bash
   mkdir transcriptions
   ```

5. Start the application:
   ```bash
   npm start
   ```

6. Open your browser to: `http://localhost:3000`

## File Naming Conventions

### Transcriptions & Artifacts
- **Raw transcriptions**: `interview_raw_YYYYMMDD_HHMMSS.txt`
- **Formatted transcriptions**: `interview_formatted_YYYYMMDD_HHMMSS.md`
- **Prompt artifacts**: `artifact_<name>_v<version>_YYYYMMDD_HHMMSS.md`
- **Metadata files**: `<basename>.meta.json`

### Prompts
- **Prompt files**: `prompt_<name>_v<version>_YYYYMMDD_HHMMSS.txt`
- **Prompt metadata**: `prompt_<name>_v<version>_YYYYMMDD_HHMMSS.meta.json`

## Usage

### Getting Started
1. Place raw transcription files in the `transcriptions/` directory
2. Start the application - it will automatically format any raw transcriptions using Claude Haiku
3. The app includes 3 pre-built prompts:
   - `format-transcription` - Formats raw transcriptions into structured markdown
   - `extract-summary` - Creates comprehensive interview summaries
   - `technical-deep-dive` - Performs deep technical analysis

### Using the Interface

The application has three main panels:

#### Left Panel: Files
- Browse all transcription and artifact files
- Filter by type (Raw, Formatted, Artifacts)
- **Click** a file to view it
- **Ctrl+Click** (or Cmd+Click) to select files for context in prompts

#### Middle Panel: Viewer
- View file contents in rendered markdown or raw text
- Toggle between Raw and Rendered views

#### Right Panel: Prompts
Two modes available via tabs:

**Saved Prompts Mode:**
- Browse and select from your saved prompts
- View prompt details before running
- Enter artifact name and select context files
- Run prompts to generate new artifacts
- Edit prompts (creates new version)
- Delete prompts (hides from list, doesn't delete file)

**Custom Prompt Mode:**
- Write one-time custom prompts
- Save prompts for future reuse
- Artifact versioning automatically increments

### Prompt Management

**Creating Prompts:**
1. Click "New Prompt" or "Save As..." from custom prompt
2. Enter name (alphanumeric and hyphens only)
3. Add description and select category
4. Write prompt text
5. Save - creates `prompt_<name>_v1_...txt`

**Editing Prompts:**
1. Select a prompt from the list
2. Click "Edit"
3. Modify content/description
4. Save - creates new version (v2, v3, etc.)
5. Original prompt remains immutable

**Deleting Prompts:**
- Click "Delete" to hide a prompt from the UI
- File remains on disk but `visible: false` in metadata
- Can be manually restored by editing the `.meta.json` file

### Running Prompts

1. Select one or more files (Ctrl+Click) for context
2. Choose a saved prompt or write custom prompt
3. Enter artifact name (e.g., "summary", "analysis")
4. Click "Run Prompt"
5. Result appears as `artifact_<name>_v1_...md`
6. Re-run with same name to create v2, v3, etc.

## Features

- **Automatic Formatting**: Raw transcriptions automatically formatted on startup
- **Saved Prompts**: Reusable, versioned prompt templates
- **Immutable Prompts**: Edit creates new versions, preserves history
- **Soft Delete**: Deleted prompts hidden but not removed from disk
- **File Browser**: Filter and browse with metadata
- **Markdown Viewer**: Rendered and raw view modes
- **Multi-file Context**: Select multiple files as prompt context
- **Artifact Versioning**: Automatic version tracking for all generated files
- **Metadata Tracking**: Full lineage of prompts, files, timestamps
