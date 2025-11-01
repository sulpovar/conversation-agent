const API_BASE = 'http://localhost:3000/api';

// State
let allFiles = [];
let allPrompts = [];
let selectedFiles = new Set();
let currentFile = null;
let currentPrompt = null;
let currentFilter = 'all';
let viewMode = 'rendered';
let promptMode = 'saved';
let editingPrompt = null;

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    loadFiles();
    loadPrompts();
    setupEventListeners();
});

// Setup event listeners
function setupEventListeners() {
    document.getElementById('refreshBtn').addEventListener('click', () => {
        loadFiles();
        loadPrompts();
    });

    document.getElementById('rawViewBtn').addEventListener('click', () => setViewMode('raw'));
    document.getElementById('renderedViewBtn').addEventListener('click', () => setViewMode('rendered'));

    document.querySelectorAll('.file-list-panel .tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.file-list-panel .tab-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            currentFilter = e.target.dataset.filter;
            renderFileList();
        });
    });

    document.getElementById('savedPromptsTabBtn').addEventListener('click', () => setPromptMode('saved'));
    document.getElementById('customPromptTabBtn').addEventListener('click', () => setPromptMode('custom'));

    document.getElementById('runPromptBtn').addEventListener('click', runCustomPrompt);
    document.getElementById('saveAsPromptBtn').addEventListener('click', () => openPromptModal('new'));

    document.getElementById('newPromptBtn').addEventListener('click', () => openPromptModal('new'));
    document.getElementById('runSavedPromptBtn').addEventListener('click', runSavedPrompt);
    document.getElementById('editPromptBtn').addEventListener('click', () => openPromptModal('edit'));
    document.getElementById('deletePromptBtn').addEventListener('click', deletePrompt);

    document.getElementById('savePromptModalBtn').addEventListener('click', savePromptFromModal);
}

// ==== FILE MANAGEMENT ====

async function loadFiles() {
    try {
        const response = await fetch(`${API_BASE}/files`);
        if (!response.ok) throw new Error('Failed to load files');
        allFiles = await response.json();
        renderFileList();
        renderSelectedFiles();
    } catch (error) {
        console.error('Error loading files:', error);
    }
}

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

async function handleFileClick(filename, event) {
    if (event.ctrlKey || event.metaKey) {
        if (selectedFiles.has(filename)) {
            selectedFiles.delete(filename);
        } else {
            selectedFiles.add(filename);
        }
        renderFileList();
        renderSelectedFiles();
    } else {
        await viewFile(filename);
    }
}

async function viewFile(filename) {
    try {
        const response = await fetch(`${API_BASE}/files/${filename}`);
        if (!response.ok) throw new Error('Failed to load file');

        const data = await response.json();
        currentFile = allFiles.find(f => f.filename === filename);
        currentFile.content = data.content;

        renderFileList();
        renderFileViewer();
    } catch (error) {
        console.error('Error loading file:', error);
        document.getElementById('fileViewer').innerHTML = `<div class="empty-state" style="color: #dc3545;">Error: ${error.message}</div>`;
    }
}

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
            viewerEl.innerHTML = marked.parse(currentFile.content);
        } else {
            viewerEl.innerHTML = `<pre>${escapeHtml(currentFile.content)}</pre>`;
        }
    }
}

function setViewMode(mode) {
    viewMode = mode;
    document.getElementById('rawViewBtn').classList.toggle('active', mode === 'raw');
    document.getElementById('renderedViewBtn').classList.toggle('active', mode === 'rendered');
    renderFileViewer();
}

function renderSelectedFiles() {
    renderSelectedFilesFor('selectedFiles');
    renderSelectedFilesFor('savedSelectedFiles');
}

function renderSelectedFilesFor(elementId) {
    const el = document.getElementById(elementId);
    if (selectedFiles.size === 0) {
        el.innerHTML = '<div class="empty-state-small">No files selected</div>';
        return;
    }

    el.innerHTML = Array.from(selectedFiles).map(filename => `
        <div class="selected-file-item">
            <span class="selected-file-name">${filename}</span>
            <button class="remove-file-btn" onclick="removeSelectedFile('${filename}')">&times;</button>
        </div>
    `).join('');
}

function removeSelectedFile(filename) {
    selectedFiles.delete(filename);
    renderFileList();
    renderSelectedFiles();
}

function clearSelection() {
    selectedFiles.clear();
    renderFileList();
    renderSelectedFiles();
}

// ==== PROMPT MANAGEMENT ====

async function loadPrompts() {
    try {
        const response = await fetch(`${API_BASE}/prompts`);
        if (!response.ok) throw new Error('Failed to load prompts');
        allPrompts = await response.json();
        renderPromptList();
    } catch (error) {
        console.error('Error loading prompts:', error);
        document.getElementById('promptList').innerHTML = '<div class="empty-state-small">Error loading prompts</div>';
    }
}

function renderPromptList() {
    const promptListEl = document.getElementById('promptList');

    if (allPrompts.length === 0) {
        promptListEl.innerHTML = '<div class="empty-state-small">No prompts found</div>';
        return;
    }

    promptListEl.innerHTML = allPrompts.map(prompt => {
        const isSelected = currentPrompt && currentPrompt.filename === prompt.filename;
        const description = prompt.metadata?.description || 'No description';
        const category = prompt.metadata?.category || 'user';

        return `
            <div class="prompt-item ${isSelected ? 'selected' : ''}" onclick="selectPrompt('${prompt.filename}')">
                <div class="prompt-item-name">${prompt.name}</div>
                <div class="prompt-item-desc">${description}</div>
                <div class="prompt-item-meta">${category} • v${prompt.version}</div>
            </div>
        `;
    }).join('');
}

async function selectPrompt(filename) {
    try {
        const response = await fetch(`${API_BASE}/prompts/${filename}`);
        if (!response.ok) throw new Error('Failed to load prompt');

        const data = await response.json();
        currentPrompt = allPrompts.find(p => p.filename === filename);
        currentPrompt.content = data.content;
        currentPrompt.metadata = data.metadata;

        renderPromptList();
        renderPromptDetails();
        updatePromptButtons();
    } catch (error) {
        console.error('Error loading prompt:', error);
        showSavedStatus('error', `Error: ${error.message}`);
    }
}

function renderPromptDetails() {
    const detailsEl = document.getElementById('promptDetails');

    if (!currentPrompt || !currentPrompt.content) {
        detailsEl.innerHTML = '<div class="empty-state-small">Select a prompt to view details</div>';
        return;
    }

    detailsEl.innerHTML = `<div class="prompt-details-content">${escapeHtml(currentPrompt.content)}</div>`;
}

function updatePromptButtons() {
    const hasPrompt = currentPrompt !== null;
    document.getElementById('runSavedPromptBtn').disabled = !hasPrompt;
    document.getElementById('editPromptBtn').disabled = !hasPrompt;
    document.getElementById('deletePromptBtn').disabled = !hasPrompt;
}

function setPromptMode(mode) {
    promptMode = mode;

    document.getElementById('savedPromptsTabBtn').classList.toggle('active', mode === 'saved');
    document.getElementById('customPromptTabBtn').classList.toggle('active', mode === 'custom');

    document.getElementById('savedPromptsView').classList.toggle('active', mode === 'saved');
    document.getElementById('customPromptView').classList.toggle('active', mode === 'custom');
}

// ==== CUSTOM PROMPT ACTIONS ====

async function runCustomPrompt() {
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

    if (!/^[a-zA-Z0-9_-]+$/.test(artifactName)) {
        showStatus('error', 'Artifact name can only contain letters, numbers, hyphens, and underscores');
        return;
    }

    try {
        showStatus('loading', 'Running prompt with Claude...');
        document.getElementById('runPromptBtn').disabled = true;

        const response = await fetch(`${API_BASE}/prompt`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
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
        showStatus('success', `Created: ${result.filename} (v${result.version})`);

        await loadFiles();
        await viewFile(result.filename);
        document.getElementById('promptText').value = '';

    } catch (error) {
        console.error('Error:', error);
        showStatus('error', `Error: ${error.message}`);
    } finally {
        document.getElementById('runPromptBtn').disabled = false;
    }
}

// ==== SAVED PROMPT ACTIONS ====

async function runSavedPrompt() {
    const artifactName = document.getElementById('savedArtifactName').value.trim();

    if (!currentPrompt) {
        showSavedStatus('error', 'Please select a prompt');
        return;
    }

    if (!artifactName) {
        showSavedStatus('error', 'Please enter an artifact name');
        return;
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(artifactName)) {
        showSavedStatus('error', 'Artifact name can only contain letters, numbers, hyphens, and underscores');
        return;
    }

    try {
        showSavedStatus('loading', 'Running prompt with Claude...');
        document.getElementById('runSavedPromptBtn').disabled = true;

        const response = await fetch(`${API_BASE}/run-saved-prompt`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                promptFilename: currentPrompt.filename,
                files: Array.from(selectedFiles),
                artifactName: artifactName
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to run prompt');
        }

        const result = await response.json();
        showSavedStatus('success', `Created: ${result.filename} (v${result.version})`);

        await loadFiles();
        await viewFile(result.filename);

    } catch (error) {
        console.error('Error:', error);
        showSavedStatus('error', `Error: ${error.message}`);
    } finally {
        document.getElementById('runSavedPromptBtn').disabled = false;
    }
}

async function deletePrompt() {
    if (!currentPrompt) return;

    if (!confirm(`Delete "${currentPrompt.name}" (v${currentPrompt.version})?`)) {
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/prompts/delete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename: currentPrompt.filename })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to delete prompt');
        }

        showSavedStatus('success', 'Prompt deleted');
        currentPrompt = null;
        await loadPrompts();
        renderPromptDetails();
        updatePromptButtons();

    } catch (error) {
        console.error('Error:', error);
        showSavedStatus('error', `Error: ${error.message}`);
    }
}

// ==== MODAL MANAGEMENT ====

function openPromptModal(mode) {
    editingPrompt = null;
    const modal = document.getElementById('promptModal');
    const title = document.getElementById('modalTitle');

    document.getElementById('modalPromptName').value = '';
    document.getElementById('modalPromptDescription').value = '';
    document.getElementById('modalPromptCategory').value = 'user';
    document.getElementById('modalPromptContent').value = '';
    hideModalStatus();

    if (mode === 'new') {
        title.textContent = 'New Prompt';
        const customPrompt = document.getElementById('promptText').value.trim();
        if (customPrompt) {
            document.getElementById('modalPromptContent').value = customPrompt;
        }
    } else if (mode === 'edit' && currentPrompt) {
        title.textContent = 'Edit Prompt (New Version)';
        editingPrompt = currentPrompt;
        document.getElementById('modalPromptName').value = currentPrompt.name;
        document.getElementById('modalPromptName').disabled = true;
        document.getElementById('modalPromptDescription').value = currentPrompt.metadata?.description || '';
        document.getElementById('modalPromptCategory').value = currentPrompt.metadata?.category || 'user';
        document.getElementById('modalPromptContent').value = currentPrompt.content || '';
    }

    modal.classList.add('active');
}

function closePromptModal() {
    document.getElementById('promptModal').classList.remove('active');
    document.getElementById('modalPromptName').disabled = false;
    editingPrompt = null;
}

async function savePromptFromModal() {
    const name = document.getElementById('modalPromptName').value.trim();
    const description = document.getElementById('modalPromptDescription').value.trim();
    const category = document.getElementById('modalPromptCategory').value;
    const content = document.getElementById('modalPromptContent').value.trim();

    if (!name) {
        showModalStatus('error', 'Please enter a prompt name');
        return;
    }

    if (!/^[a-zA-Z0-9-]+$/.test(name)) {
        showModalStatus('error', 'Name can only contain letters, numbers, and hyphens');
        return;
    }

    if (!content) {
        showModalStatus('error', 'Please enter prompt content');
        return;
    }

    try {
        showModalStatus('loading', 'Saving prompt...');
        document.getElementById('savePromptModalBtn').disabled = true;

        const endpoint = editingPrompt ? '/api/prompts/edit' : '/api/prompts';
        const body = editingPrompt
            ? { filename: editingPrompt.filename, content, description }
            : { name, content, description, category };

        const response = await fetch(`${API_BASE}${endpoint.replace('/api', '')}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to save prompt');
        }

        const result = await response.json();
        showModalStatus('success', `Saved: v${result.version}`);

        setTimeout(async () => {
            closePromptModal();
            await loadPrompts();
            await selectPrompt(result.filename);
        }, 1000);

    } catch (error) {
        console.error('Error:', error);
        showModalStatus('error', `Error: ${error.message}`);
    } finally {
        document.getElementById('savePromptModalBtn').disabled = false;
    }
}

// ==== UTILITY FUNCTIONS ====

function showStatus(type, message) {
    const el = document.getElementById('promptStatus');
    el.className = `status-message ${type}`;
    el.textContent = message;
    if (type === 'success') setTimeout(() => hideStatus(), 5000);
}

function hideStatus() {
    const el = document.getElementById('promptStatus');
    el.className = 'status-message';
    el.textContent = '';
}

function showSavedStatus(type, message) {
    const el = document.getElementById('savedPromptStatus');
    el.className = `status-message ${type}`;
    el.textContent = message;
    if (type === 'success') setTimeout(() => hideSavedStatus(), 5000);
}

function hideSavedStatus() {
    const el = document.getElementById('savedPromptStatus');
    el.className = 'status-message';
    el.textContent = '';
}

function showModalStatus(type, message) {
    const el = document.getElementById('modalStatus');
    el.className = `status-message ${type}`;
    el.textContent = message;
}

function hideModalStatus() {
    const el = document.getElementById('modalStatus');
    el.className = 'status-message';
    el.textContent = '';
}

function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Global functions
window.handleFileClick = handleFileClick;
window.removeSelectedFile = removeSelectedFile;
window.selectPrompt = selectPrompt;
window.closePromptModal = closePromptModal;
