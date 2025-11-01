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

- **Raw transcriptions**: `interview_raw_YYYYMMDD_HHMMSS.txt`
- **Formatted transcriptions**: `interview_formatted_YYYYMMDD_HHMMSS.md`
- **Prompt artifacts**: `artifact_<name>_v<version>_YYYYMMDD_HHMMSS.md`
- **Metadata files**: `<basename>.meta.json`

## Usage

1. Place raw transcription files in the `transcriptions/` directory
2. Start the application - it will automatically format any raw transcriptions
3. Use the web interface to:
   - Browse files
   - View file contents
   - Run prompts against files to generate new artifacts
   - Re-run prompts to create new versions

## Features

- Automatic transcription formatting using Claude Haiku
- File browser with metadata
- Markdown viewer
- Prompt interface for generating artifacts
- Version control for generated files
- Metadata tracking (prompts, timestamps, versions)
