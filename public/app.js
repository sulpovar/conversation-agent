const API_BASE = 'http://localhost:3000/api';

let allFiles = [];
let selectedFiles = new Set();
let currentFile = null;
let currentFilter = 'all';
let viewMode = 'rendered'; // 'rendered' or 'raw'

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    loadFiles();
    setupEventListeners();
});

// Setup event listeners
function setupEventListeners() {
    document.getElementById('refreshBtn').addEventListener('click', loadFiles);
    document.getElementById('runPromptBtn').addEventListener('click', runPrompt);
    document.getElementById('clearSelectionBtn').addEventListener('click', clearSelection);
    document.getElementById('rawViewBtn').addEventListener('click', () => setViewMode('raw'));
    document.getElementById('renderedViewBtn').addEventListener('click', () => setViewMode('rendered'));

    // Filter tabs
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            currentFilter = e.target.dataset.filter;
            renderFileList();
        });
    });
}

// Load files from API
async function loadFiles() {
    try {
        showStatus('loading', 'Loading files...');
        const response = await fetch(`${API_BASE}/files`);

        if (!response.ok) {
            throw new Error('Failed to load files');
        }

        allFiles = await response.json();
        renderFileList();
        hideStatus();
    } catch (error) {
        console.error('Error loading files:', error);
        showStatus('error', `Error loading files: ${error.message}`);
    }
}

// Render file list
function renderFileList() {
    const fileListEl = document.getElementById('fileList');
    const filteredFiles = allFiles.filter(file => {
        if (currentFilter === 'all') return true;
        return file.type === currentFilter;
    });

    if (filteredFiles.length === 0) {
        fileListEl.innerHTML = '<div class="empty-state-small">No files found</div>';
        return;
    }

    fileListEl.innerHTML = filteredFiles.map(file => {
        const isSelected = selectedFiles.has(file.filename);
        const isActive = currentFile && currentFile.filename === file.filename;
        const badgeClass = `badge-${file.type}`;
        const fileSize = formatFileSize(file.size);
        const modifiedDate = new Date(file.modified).toLocaleString();

        return `
            <div class="file-item ${isSelected ? 'selected' : ''} ${isActive ? 'active' : ''}"
                 data-filename="${file.filename}"
                 onclick="handleFileClick('${file.filename}', event)">
                <div class="file-name">
                    <span class="file-badge ${badgeClass}">${file.type}</span>
                    ${file.filename}
                </div>
                <div class="file-meta">
                    ${fileSize} • ${modifiedDate}
                    ${file.version ? ` • v${file.version}` : ''}
                </div>
            </div>
        `;
    }).join('');
}

// Handle file click
async function handleFileClick(filename, event) {
    if (event.ctrlKey || event.metaKey) {
        // Multi-select with Ctrl/Cmd
        if (selectedFiles.has(filename)) {
            selectedFiles.delete(filename);
        } else {
            selectedFiles.add(filename);
        }
        renderFileList();
        renderSelectedFiles();
    } else {
        // View file
        await viewFile(filename);
    }
}

// View file
async function viewFile(filename) {
    try {
        const response = await fetch(`${API_BASE}/files/${filename}`);

        if (!response.ok) {
            throw new Error('Failed to load file');
        }

        const data = await response.json();
        currentFile = allFiles.find(f => f.filename === filename);
        currentFile.content = data.content;

        renderFileList();
        renderFileViewer();
    } catch (error) {
        console.error('Error loading file:', error);
        const viewerEl = document.getElementById('fileViewer');
        viewerEl.innerHTML = `<div class="empty-state" style="color: #dc3545;">Error loading file: ${error.message}</div>`;
    }
}

// Render file viewer
function renderFileViewer() {
    const viewerEl = document.getElementById('fileViewer');

    if (!currentFile || !currentFile.content) {
        viewerEl.innerHTML = '<div class="empty-state">Select a file to view its contents</div>';
        return;
    }

    if (viewMode === 'raw') {
        viewerEl.className = 'file-viewer raw-view';
        viewerEl.textContent = currentFile.content;
    } else {
        viewerEl.className = 'file-viewer';

        if (currentFile.filename.endsWith('.md')) {
            // Render markdown
            viewerEl.innerHTML = marked.parse(currentFile.content);
        } else {
            // Show as plain text
            viewerEl.innerHTML = `<pre>${escapeHtml(currentFile.content)}</pre>`;
        }
    }
}

// Set view mode
function setViewMode(mode) {
    viewMode = mode;

    document.getElementById('rawViewBtn').classList.toggle('active', mode === 'raw');
    document.getElementById('renderedViewBtn').classList.toggle('active', mode === 'rendered');

    renderFileViewer();
}

// Render selected files
function renderSelectedFiles() {
    const selectedFilesEl = document.getElementById('selectedFiles');

    if (selectedFiles.size === 0) {
        selectedFilesEl.innerHTML = '<div class="empty-state-small">No files selected</div>';
        return;
    }

    selectedFilesEl.innerHTML = Array.from(selectedFiles).map(filename => `
        <div class="selected-file-item">
            <span class="selected-file-name">${filename}</span>
            <button class="remove-file-btn" onclick="removeSelectedFile('${filename}')">&times;</button>
        </div>
    `).join('');
}

// Remove selected file
function removeSelectedFile(filename) {
    selectedFiles.delete(filename);
    renderFileList();
    renderSelectedFiles();
}

// Clear selection
function clearSelection() {
    selectedFiles.clear();
    renderFileList();
    renderSelectedFiles();
}

// Run prompt
async function runPrompt() {
    const artifactName = document.getElementById('artifactName').value.trim();
    const promptText = document.getElementById('promptText').value.trim();

    if (!artifactName) {
        showStatus('error', 'Please enter an artifact name');
        return;
    }

    if (!promptText) {
        showStatus('error', 'Please enter a prompt');
        return;
    }

    // Validate artifact name (alphanumeric and hyphens/underscores only)
    if (!/^[a-zA-Z0-9_-]+$/.test(artifactName)) {
        showStatus('error', 'Artifact name can only contain letters, numbers, hyphens, and underscores');
        return;
    }

    try {
        showStatus('loading', 'Running prompt with Claude...');
        document.getElementById('runPromptBtn').disabled = true;

        const response = await fetch(`${API_BASE}/prompt`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                prompt: promptText,
                files: Array.from(selectedFiles),
                artifactName: artifactName
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to run prompt');
        }

        const result = await response.json();

        showStatus('success', `Created: ${result.filename} (version ${result.version})`);

        // Reload files and view the new artifact
        await loadFiles();
        await viewFile(result.filename);

        // Clear prompt text but keep artifact name and selection
        document.getElementById('promptText').value = '';

    } catch (error) {
        console.error('Error running prompt:', error);
        showStatus('error', `Error: ${error.message}`);
    } finally {
        document.getElementById('runPromptBtn').disabled = false;
    }
}

// Show status message
function showStatus(type, message) {
    const statusEl = document.getElementById('promptStatus');
    statusEl.className = `status-message ${type}`;
    statusEl.textContent = message;
}

// Hide status message
function hideStatus() {
    const statusEl = document.getElementById('promptStatus');
    statusEl.className = 'status-message';
    statusEl.textContent = '';
}

// Format file size
function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// Escape HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Make functions globally accessible
window.handleFileClick = handleFileClick;
window.removeSelectedFile = removeSelectedFile;
