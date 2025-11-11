const API_BASE = 'http://localhost:3000/api';

// State
let allFiles = [];
let allAgents = []; // Renamed from allPrompts
let selectedFiles = new Map(); // Changed from Set to Map for topic support
let fileTopics = new Map(); // Cache of filename -> topics array
let currentFile = null;
let currentAgent = null; // Renamed from currentPrompt
let currentFilter = 'all';
let viewMode = 'rendered';
let promptMode = 'saved';
let editingPrompt = null;

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    loadFiles();
    loadAgents(); // Renamed from loadPrompts
    setupEventListeners();
});

// Setup event listeners
function setupEventListeners() {
    document.getElementById('formatBtn').addEventListener('click', formatTranscriptions);
    document.getElementById('syncRagBtn').addEventListener('click', syncSelectedToRAG);
    document.getElementById('refreshBtn').addEventListener('click', () => {
        loadFiles();
        loadAgents(); // Renamed from loadPrompts
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
    document.getElementById('clearCustomSelectionBtn').addEventListener('click', clearSelection);

    document.getElementById('newPromptBtn').addEventListener('click', () => openPromptModal('new'));
    document.getElementById('runSavedPromptBtn').addEventListener('click', runSelectedAgent);
    document.getElementById('editPromptBtn').addEventListener('click', () => openPromptModal('edit'));
    document.getElementById('deletePromptBtn').addEventListener('click', deletePrompt);
    document.getElementById('clearSavedSelectionBtn').addEventListener('click', clearSelection);

    document.getElementById('savePromptModalBtn').addEventListener('click', savePromptFromModal);

    // RAG toggle handlers
    document.getElementById('useSavedRAG').addEventListener('change', toggleRAGOptions);
    document.getElementById('useCustomRAG').addEventListener('change', toggleRAGOptions);
}

// ==== RAG FUNCTIONS ====

async function syncSelectedToRAG() {
    const btn = document.getElementById('syncRagBtn');
    const originalText = btn.textContent;

    // Get the currently highlighted (active) file
    if (!currentFile || !currentFile.filename) {
        alert('Please highlight a file first by clicking on it');
        return;
    }

    // Check if it's a formatted file
    if (!currentFile.filename.startsWith('interview_formatted_') || !currentFile.filename.endsWith('.md')) {
        alert('Please highlight a formatted file (interview_formatted_*.md)');
        return;
    }

    try {
        btn.disabled = true;
        btn.textContent = '⏳ Syncing...';

        const response = await fetch(`${API_BASE}/rag/sync`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ files: [currentFile.filename] })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to sync to RAG');
        }

        const result = await response.json();
        alert(`✅ Synced ${result.filesProcessed} file(s), ${result.chunksAdded} chunks to RAG index`);

    } catch (error) {
        console.error('Error syncing to RAG:', error);
        alert(`Error: ${error.message}`);
    } finally {
        btn.disabled = false;
        btn.textContent = originalText;
    }
}

function toggleRAGOptions(event) {
    const checkbox = event.target;
    const isCustom = checkbox.id === 'useCustomRAG';
    const optionsId = isCustom ? 'customRagOptions' : 'savedRagOptions';
    const optionsEl = document.getElementById(optionsId);

    if (checkbox.checked) {
        optionsEl.style.display = 'block';
    } else {
        optionsEl.style.display = 'none';
    }
}

// ==== FILE MANAGEMENT ====

async function formatTranscriptions() {
    const btn = document.getElementById('formatBtn');
    const originalText = btn.textContent;

    try {
        btn.disabled = true;
        btn.textContent = '⏳ Formatting...';

        const response = await fetch(`${API_BASE}/format-transcriptions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to format transcriptions');
        }

        const result = await response.json();

        // Show result message
        let message = '';
        if (result.processed === 0 && result.skipped === 0) {
            message = 'No raw transcriptions found';
        } else {
            message = `Formatted: ${result.processed}, Skipped: ${result.skipped}`;
            if (result.totalDuration) {
                message += ` (${(result.totalDuration / 1000).toFixed(1)}s)`;
            }
        }

        alert(message);

        // Refresh file list if any were processed
        if (result.processed > 0) {
            await loadFiles();
        }

    } catch (error) {
        console.error('Error formatting transcriptions:', error);
        alert(`Error: ${error.message}`);
    } finally {
        btn.disabled = false;
        btn.textContent = originalText;
    }
}

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
        // Toggle selection - use Map.has() which works for both Set and Map
        if (selectedFiles.has(filename)) {
            selectedFiles.delete(filename);
        } else {
            // For Map, set with empty object to indicate whole file selection
            if (selectedFiles instanceof Map) {
                selectedFiles.set(filename, { topics: [] });
            } else {
                selectedFiles.add(filename);
            }
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

async function renderFileViewer() {
    const viewerEl = document.getElementById('fileViewer');

    if (!currentFile || !currentFile.content) {
        viewerEl.innerHTML = '<div class="empty-state">Select a file to view its contents</div>';
        return;
    }

    let contentHtml = '';

    if (viewMode === 'raw') {
        viewerEl.className = 'file-viewer raw-view';
        viewerEl.textContent = currentFile.content;
        return;
    } else {
        viewerEl.className = 'file-viewer';
        if (currentFile.filename.endsWith('.md')) {
            contentHtml = marked.parse(currentFile.content);
        } else {
            contentHtml = `<pre>${escapeHtml(currentFile.content)}</pre>`;
        }
    }

    // Add topics UI for markdown files
    const topicsUI = await renderTopicsUI(currentFile.filename);
    if (topicsUI) {
        viewerEl.innerHTML = topicsUI + contentHtml;
    } else {
        viewerEl.innerHTML = contentHtml;
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

    let html = '';

    // Handle both Set and Map structures
    if (selectedFiles instanceof Map) {
        selectedFiles.forEach((selection, filename) => {
            const topics = selection.topics || [];
            const topicInfo = topics.length > 0
                ? `<div class="selected-file-topics">${topics.length} topic(s) selected</div>`
                : '';
            html += `
                <div class="selected-file-item">
                    <span class="selected-file-name">${filename}</span>
                    ${topicInfo}
                    <button class="remove-file-btn" onclick="removeSelectedFile('${filename}')">&times;</button>
                </div>
            `;
        });
    } else {
        // Fallback for Set structure
        html = Array.from(selectedFiles).map(filename => `
            <div class="selected-file-item">
                <span class="selected-file-name">${filename}</span>
                <button class="remove-file-btn" onclick="removeSelectedFile('${filename}')">&times;</button>
            </div>
        `).join('');
    }

    el.innerHTML = html;
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

async function loadAgents() {
    try {
        const response = await fetch(`${API_BASE}/agents`);
        if (!response.ok) throw new Error('Failed to load agents');
        allAgents = await response.json();
        renderAgentList(); // Renamed from renderPromptList
    } catch (error) {
        console.error('Error loading agents:', error);
        document.getElementById('promptList').innerHTML = '<div class="empty-state-small">Error loading agents</div>';
    }
}

// Backward compatibility - keep loadPrompts as alias
async function loadPrompts() {
    return loadAgents();
}

function renderAgentList() {
    const promptListEl = document.getElementById('promptList');

    if (allAgents.length === 0) {
        promptListEl.innerHTML = '<div class="empty-state-small">No agents found</div>';
        return;
    }

    promptListEl.innerHTML = allAgents.map(agent => {
        const isSelected = currentAgent && currentAgent.filename === agent.filename;
        const description = agent.metadata?.description || 'No description';
        const category = agent.metadata?.category || 'user';

        // Agent type badge
        const agentTypeBadge = agent.agentType === 'flow'
            ? '<span class="agent-type-badge agent-type-flow">🔄 Flow</span>'
            : '<span class="agent-type-badge agent-type-prompt">📝 Prompt</span>';

        return `
            <div class="prompt-item ${isSelected ? 'selected' : ''}" onclick="selectAgent('${agent.filename}')">
                <div class="agent-item-header">
                    <div class="prompt-item-name">${agent.name}</div>
                    ${agentTypeBadge}
                </div>
                <div class="prompt-item-desc">${description}</div>
                <div class="prompt-item-meta">${category} • v${agent.version}</div>
            </div>
        `;
    }).join('');
}

// Backward compatibility
function renderPromptList() {
    return renderAgentList();
}

async function selectAgent(filename) {
    try {
        const response = await fetch(`${API_BASE}/agents/${filename}`);
        if (!response.ok) throw new Error('Failed to load agent');

        const data = await response.json();
        currentAgent = allAgents.find(a => a.filename === filename);
        currentAgent.content = data.content;
        currentAgent.metadata = data.metadata;
        currentAgent.agentType = data.agentType;

        renderAgentList(); // Renamed from renderPromptList
        renderPromptDetails();
        updatePromptButtons();
    } catch (error) {
        console.error('Error loading agent:', error);
        showSavedStatus('error', `Error: ${error.message}`);
    }
}

// Backward compatibility
async function selectPrompt(filename) {
    return selectAgent(filename);
}

function renderPromptDetails() {
    const detailsEl = document.getElementById('promptDetails');

    if (!currentAgent || !currentAgent.content) {
        detailsEl.innerHTML = '<div class="empty-state-small">Select an agent to view details</div>';
        return;
    }

    // For flows, show JSON; for prompts, show text
    if (currentAgent.agentType === 'flow') {
        detailsEl.innerHTML = `<div class="prompt-details-content"><pre>${escapeHtml(JSON.stringify(currentAgent.content, null, 2))}</pre></div>`;
    } else {
        detailsEl.innerHTML = `<div class="prompt-details-content">${escapeHtml(currentAgent.content)}</div>`;
    }
}

function updatePromptButtons() {
    const hasAgent = currentAgent !== null;
    document.getElementById('runSavedPromptBtn').disabled = !hasAgent;
    document.getElementById('editPromptBtn').disabled = !hasAgent;
    document.getElementById('deletePromptBtn').disabled = !hasAgent;
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
    const promptText = document.getElementById('promptText').value.trim();

    if (!promptText) {
        showStatus('error', 'Please enter a prompt');
        return;
    }

    try {
        showStatus('loading', 'Running prompt with Claude...');
        document.getElementById('runPromptBtn').disabled = true;

        // Get RAG parameters
        const useRAG = document.getElementById('useCustomRAG').checked;
        const ragQuery = document.getElementById('customRagQuery').value.trim();
        const ragTopK = parseInt(document.getElementById('customRagTopK').value);

        const requestBody = {
            prompt: promptText,
            files: getSelectedFilesForAPI()
        };

        if (useRAG) {
            requestBody.useRAG = true;
            if (ragQuery) requestBody.ragQuery = ragQuery;
            requestBody.ragTopK = ragTopK;
        }

        const response = await fetch(`${API_BASE}/prompt`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
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

async function runSelectedAgent() {
    if (!currentAgent) {
        showSavedStatus('error', 'Please select an agent');
        return;
    }

    try {
        const agentType = currentAgent.agentType === 'flow' ? 'flow' : 'prompt';
        const statusMsg = agentType === 'flow' ? 'Running flow...' : 'Running prompt with Claude...';
        showSavedStatus('loading', statusMsg);
        document.getElementById('runSavedPromptBtn').disabled = true;

        // Get RAG parameters
        const useRAG = document.getElementById('useSavedRAG').checked;
        const ragQuery = document.getElementById('savedRagQuery').value.trim();
        const ragTopK = parseInt(document.getElementById('savedRagTopK').value);

        const requestBody = {
            agentFilename: currentAgent.filename,
            files: getSelectedFilesForAPI()
        };

        if (useRAG) {
            requestBody.useRAG = true;
            if (ragQuery) requestBody.ragQuery = ragQuery;
            requestBody.ragTopK = ragTopK;
        }

        const response = await fetch(`${API_BASE}/run-agent`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || `Failed to run ${agentType}`);
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

// Backward compatibility
async function runSavedPrompt() {
    return runSelectedAgent();
}

async function deletePrompt() {
    if (!currentAgent) return;

    const agentType = currentAgent.agentType === 'flow' ? 'flow' : 'prompt';
    if (!confirm(`Delete "${currentAgent.name}" (v${currentAgent.version})?`)) {
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/prompts/delete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename: currentAgent.filename })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || `Failed to delete ${agentType}`);
        }

        showSavedStatus('success', `${agentType.charAt(0).toUpperCase() + agentType.slice(1)} deleted`);
        currentAgent = null;
        await loadAgents();
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
