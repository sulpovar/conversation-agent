
// ==== TOPIC SELECTION SUPPORT ====

// Enhanced state (add these to existing state variables)
// let fileTopics = new Map(); // Cache of filename -> topics array
// Update selectedFiles from Set to Map: let selectedFiles = new Map();

// Load topics for a markdown file
async function loadTopics(filename) {
    try {
        const response = await fetch(`${API_BASE}/files/${filename}/topics`);
        if (!response.ok) return null;
        const data = await response.json();
        fileTopics.set(filename, data.topics);
        return data.topics;
    } catch (error) {
        console.error('Error loading topics:', error);
        return null;
    }
}

// Render topics UI in the viewer
async function renderTopicsUI(filename) {
    if (!filename.endsWith('.md')) return '';

    const topics = fileTopics.get(filename) || await loadTopics(filename);
    if (!topics || topics.length === 0) return '';

    const selectedForFile = selectedFiles.get(filename) || {};
    const selectedTopicIds = selectedForFile.topics || [];
    const wholeFileSelected = !selectedFiles.has(filename) || selectedTopicIds.length === 0;

    let html = '<div class="topics-panel">';
    html += '<div class="topics-header"><h3>📑 Topics</h3><p>Select specific topics to use as context:</p></div>';
    html += '<div class="topics-list">';

    // Whole file option
    html += '<label class="topic-item">';
    html += `<input type="checkbox" ${wholeFileSelected ? 'checked' : ''} onchange="selectWholeFile('${filename}')">`;
    html += '<span class="topic-title"><strong>Entire File</strong></span></label>';

    // Individual topics
    topics.forEach(topic => {
        const escapedId = topic.id.replace(/'/g, "\\'");
        html += '<label class="topic-item">';
        html += `<input type="checkbox" ${selectedTopicIds.includes(topic.id) ? 'checked' : ''} onchange="toggleTopic('${filename}', '${escapedId}')">`;
        html += `<span class="topic-title">${escapeHtml(topic.title)}</span></label>`;
    });

    html += '</div><div class="topics-actions">';
    html += `<button class="btn-small" onclick="selectAllTopics('${filename}')">Select All</button>`;
    html += `<button class="btn-small" onclick="clearTopicSelection('${filename}')">Clear</button>`;
    html += '</div></div>';

    return html;
}

// Helper to escape HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Toggle individual topic selection
function toggleTopic(filename, topicId) {
    let fileSelection = selectedFiles.get(filename) || {topics: []};

    if (!fileSelection.topics) {
        fileSelection.topics = [];
    }

    const index = fileSelection.topics.indexOf(topicId);
    if (index > -1) {
        fileSelection.topics.splice(index, 1);
    } else {
        fileSelection.topics.push(topicId);
    }

    // If no topics selected, remove from map (means whole file)
    if (fileSelection.topics.length === 0) {
        selectedFiles.delete(filename);
    } else {
        selectedFiles.set(filename, fileSelection);
    }

    renderSelectedFiles();
    updateTopicsCheckboxes(filename);
}

// Select whole file (clear topic selection)
function selectWholeFile(filename) {
    selectedFiles.delete(filename);
    updateTopicsCheckboxes(filename);
    renderSelectedFiles();
}

// Update checkboxes to match current state
function updateTopicsCheckboxes(filename) {
    const fileSelection = selectedFiles.get(filename);
    const selectedTopicIds = fileSelection?.topics || [];
    const wholeFileSelected = !fileSelection || selectedTopicIds.length === 0;

    document.querySelectorAll(`.topics-panel input[type="checkbox"]`).forEach(cb => {
        const onchange = cb.getAttribute('onchange');
        if (onchange && onchange.includes(filename)) {
            if (onchange.includes('selectWholeFile')) {
                cb.checked = wholeFileSelected;
            } else {
                const match = onchange.match(/toggleTopic\([^,]+,\s*'([^']+)'\)/);
                if (match) {
                    const topicId = match[1].replace(/\\'/g, "'");
                    cb.checked = selectedTopicIds.includes(topicId);
                }
            }
        }
    });
}

// Select all topics
function selectAllTopics(filename) {
    const topics = fileTopics.get(filename);
    if (!topics) return;

    selectedFiles.set(filename, {
        topics: topics.map(t => t.id)
    });

    updateTopicsCheckboxes(filename);
    renderSelectedFiles();
}

// Clear topic selection for a file
function clearTopicSelection(filename) {
    selectedFiles.delete(filename);
    updateTopicsCheckboxes(filename);
    renderSelectedFiles();
}

// Convert selection Map to API format
function getSelectedFilesForAPI() {
    const result = [];

    // Handle backward compatibility - check if selectedFiles is still a Set
    if (selectedFiles instanceof Set) {
        return Array.from(selectedFiles);
    }

    // New Map-based format
    selectedFiles.forEach((selection, filename) => {
        if (!selection.topics || selection.topics.length === 0) {
            result.push(filename);
        } else {
            result.push({
                file: filename,
                topicIds: selection.topics
            });
        }
    });

    return result;
}

// Expose functions globally for onclick handlers
window.toggleTopic = toggleTopic;
window.selectWholeFile = selectWholeFile;
window.selectAllTopics = selectAllTopics;
window.clearTopicSelection = clearTopicSelection;
