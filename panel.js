// panel.js

document.addEventListener('DOMContentLoaded', () => {
    // UI Elements
    const $ = id => document.getElementById(id);
    const form = document.querySelector('form');
    const loader = document.querySelector('.loader');
    const statusDiv = $('ds-status');
    const resultsBox = $('deepSearchResults');
    const stopButton = $('ds-stop');
    const exportJsonButton = $('ds-export-json');
    const exportCsvButton = $('ds-export-csv');
    const typeFilter = $('ds-type-filter');
    const searchButton = form.querySelector('button[type="submit"]');
    
    // Search button is ready immediately - no cache needed
    searchButton.disabled = false;
    searchButton.textContent = 'Search';

    // State
    let currentResults = [];
    let filteredResults = [];
    let lastRenderedIndex = 0;
    let resultsTable = null;
    let port;
    let connectionEstablished = false;
    let instanceId = Date.now() + Math.random(); // Unique instance ID
    
    // Chunked message handling
    let chunkBuffer = new Map(); // Store chunks by action type
    
    function processChunkedMessage(message) {
        const { action, payload } = message;
        
        if (!payload || !payload.isChunk) {
            // Not a chunked message, process normally
            return message;
        }
        
        const { isChunk, chunkIndex, totalChunks, isLastChunk } = payload;
        
        // Initialize buffer for this action if needed
        if (!chunkBuffer.has(action)) {
            chunkBuffer.set(action, {
                chunks: new Array(totalChunks),
                receivedChunks: 0,
                basePayload: { ...payload } // Store the base payload structure
            });
        }
        
        const buffer = chunkBuffer.get(action);
        
        // Determine what data to extract based on action type
        let chunkData;
        if (action === 'searchComplete' || action === 'searchPartial') {
            chunkData = payload.results;
        } else if (action === 'objectProperties') {
            chunkData = payload.properties;
        } else if (action === 'exploreResults') {
            chunkData = payload.results;
        } else {
            // Default to results for unknown types
            chunkData = payload.results || payload.data;
        }
        
        // Store this chunk
        buffer.chunks[chunkIndex] = chunkData;
        buffer.receivedChunks++;
        
        // If we have all chunks, combine them
        if (buffer.receivedChunks === totalChunks) {
            // Combine all chunks in order
            const combinedData = [];
            for (const chunk of buffer.chunks) {
                if (chunk) {
                    combinedData.push(...chunk);
                }
            }
            
            // Create the final payload based on action type
            let finalPayload;
            if (action === 'searchComplete' || action === 'searchPartial') {
                finalPayload = {
                    ...buffer.basePayload,
                    results: combinedData,
                    isChunk: false
                };

            } else if (action === 'objectProperties') {
                finalPayload = {
                    ...buffer.basePayload,
                    properties: combinedData,
                    isChunk: false
                };
            } else if (action === 'exploreResults') {
                finalPayload = {
                    ...buffer.basePayload,
                    results: combinedData,
                    isChunk: false
                };
            } else {
                // Default structure
                finalPayload = {
                    ...buffer.basePayload,
                    results: combinedData,
                    isChunk: false
                };
            }
            
            // Clean up buffer
            chunkBuffer.delete(action);
            
            // Return the combined message
            return {
                ...message,
                payload: finalPayload
            };
        }
        
        // Not all chunks received yet, return null to indicate incomplete
        return null;
    }

    // Add a new message listener to handle incoming messages from the background script
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        // Process chunked messages first
        const processedMessage = processChunkedMessage(message);
        if (!processedMessage) {
            // If it's an incomplete chunked message, do nothing yet
            return true; // Indicate that the response will be sent asynchronously
        }

        const { action, payload } = processedMessage;

        switch (action) {
            case 'searchComplete':
                currentResults = payload.results;
                filteredResults = currentResults; // Reset filtered results on new search
                appendResults(filteredResults, true);
                let completeStatusText = `Search complete. Found ${currentResults.length} results.`;
                if (payload.skipped && payload.skipped > 0) completeStatusText += ` (${payload.skipped} test/debug paths skipped)`;
                statusDiv.textContent = completeStatusText;
                loader.style.display = 'none';
                searchButton.disabled = false;
                stopButton.style.display = 'none';
                break;
            case 'searchPartial':
                // For partial results, append new results immediately
                const newPartialResults = payload.results || [];
                currentResults = currentResults.concat(newPartialResults);
                filteredResults = currentResults; // Keep filtered results in sync
                appendResults(currentResults, false); // Pass the full current results array
                let partialStatusText = `Searching: ${payload.status} (Depth: ${payload.depth}, Queue: ${payload.queue}, Found: ${currentResults.length})`;
                if (payload.skipped && payload.skipped > 0) partialStatusText += ` (Skipped: ${payload.skipped} test/debug paths)`;
                statusDiv.textContent = partialStatusText;
                break;
            case 'searchError':
                statusDiv.textContent = `Search error: ${payload.message}`;
                loader.style.display = 'none';
                searchButton.disabled = false;
                stopButton.style.display = 'none';
                break;
            case 'searchCancelled':
                let cancelStatusText = `Search cancelled: ${payload.message}`;
                if (payload.skipped && payload.skipped > 0) cancelStatusText += ` (${payload.skipped} test/debug paths skipped)`;
                statusDiv.textContent = cancelStatusText;
                loader.style.display = 'none';
                searchButton.disabled = false;
                stopButton.style.display = 'none';
                break;

            case 'exploreResults':
                currentResults = payload.results;
                filteredResults = currentResults; // Reset filtered results on new exploration
                initializeResultsTable();
                appendResults(filteredResults, true);
                statusDiv.textContent = `Exploration complete. Found ${currentResults.length} results.`;
                loader.style.display = 'none';
                searchButton.disabled = false;
                stopButton.style.display = 'none';
                break;
            case 'clearResults':
                currentResults = [];
                filteredResults = [];
                initializeResultsTable();
                statusDiv.textContent = '';
                exportJsonButton.disabled = true;
                exportCsvButton.disabled = true;
                break;
            default:
                console.log('Unknown message action:', action, payload);
        }
        return true; // Indicate that the response will be sent asynchronously
    });

    // --- COMMUNICATION SETUP ---
    function connect() {
        if (connectionEstablished) return;
        
        port = chrome.runtime.connect({ name: 'devtools-page' });
        port.postMessage({ 
            name: 'init', 
            tabId: chrome.devtools.inspectedWindow.tabId,
            instanceId: instanceId
        });

        port.onMessage.addListener(function (msg) {
            if (msg.action === 'objectProperties') {
                // Handle the nested payload structure from content script
                if (msg.payload) {
                    const { properties, path, error } = msg.payload;
                    const success = !error;
                    handleObjectProperties(path, properties, success);
                } else {
                    // Fallback for direct structure (if any)
                    handleObjectProperties(msg.path, msg.properties, msg.success);
                }
            }
            // Handle other messages as needed
        });

        port.onDisconnect.addListener(() => {
            connectionEstablished = false;
            port = null;
        });
        
        connectionEstablished = true;
    }

    function handleObjectProperties(path, properties, success) {
        if (!success) {
            statusDiv.textContent = 'Failed to get object properties.';
            return;
        }

        // Find the row that was expanded using a CSS-safe selector
        // Escape special characters in the path for CSS selector
        const escapedPath = path.replace(/["\\]/g, '\\$&');
        const expandedRow = document.querySelector(`[data-expanded-path="${escapedPath}"]`);
        if (expandedRow) {
            displayObjectProperties(expandedRow, properties);
        }
        statusDiv.textContent = 'Object expanded.';
    }

    // --- UTILITY AND RENDER FUNCTIONS (Copied from your original script) ---

    // --- UTILITY AND RENDER FUNCTIONS (Copied from your original script) ---
    const escapeHTML = str => str?.toString().replace(/[&<>']]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":"&#39;",'"':'&quot;'}[c])) ?? '';

    function safeStringify(obj, space = 2) {
      const seen = new WeakSet();
      return JSON.stringify(obj, (key, value) => {
        if (typeof value === "object" && value !== null) {
          if (seen.has(value)) return "[Circular]";
          seen.add(value);
        }
        return value;
      }, space);
    }

    function fallbackCopyText(text) {
      // Create a temporary textarea element
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      textarea.style.pointerEvents = 'none';
      document.body.appendChild(textarea);
      
      try {
        textarea.select();
        textarea.setSelectionRange(0, 99999); // For mobile devices
        document.execCommand('copy');
      } catch (err) {
        console.error('Failed to copy text:', err);
      } finally {
        document.body.removeChild(textarea);
      }
    }

    function initializeResultsTable() {
        resultsBox.innerHTML = '';
        resultsTable = document.createElement('table');
        resultsTable.innerHTML = `<thead><tr><th>#</th><th>Path</th><th>Type</th><th>Preview</th><th>Actions</th></tr></thead><tbody></tbody>`;
        resultsBox.appendChild(resultsTable);
        lastRenderedIndex = 0;
    }

    function appendResults(newResults, isFinal) {
        if (!resultsTable) return;
        const tbody = resultsTable.querySelector('tbody');
        
        // Only render new results that haven't been rendered yet
        const resultsToRender = newResults.slice(lastRenderedIndex);
        resultsToRender.forEach((r, i) => {
            const globalIndex = lastRenderedIndex + i;
            // The value from the inspected page is a raw object/primitive, not a string.
            // We need to re-evaluate its type and how to display it.
            const row = createResultRow(r, globalIndex, newResults);
            tbody.appendChild(row);
        });
        
        // Update the last rendered index
        lastRenderedIndex = newResults.length;
        
        if (isFinal) {
            if (newResults.length === 0) {
                resultsBox.innerHTML = '<p>No results found.</p>';
            }
            exportJsonButton.disabled = newResults.length === 0;
            exportCsvButton.disabled = newResults.length === 0;
        }
    }

    function createResultRow(r, i, results) {
        const row = document.createElement('tr');
        
        // Add visual indication for test data
        if (r.isTestData) {
            row.classList.add('test-data-row');
            row.title = 'This result is from test/debug data';
        }
        
        // Use originalValue for display if available, otherwise fall back to value
        const displayValue = r.originalValue || r.value;
        const fullPath = r.path;
        const displayPath = fullPath.replace(/^window\./, '');
        const isObj = r.type === 'object' && displayValue !== null && displayValue !== 'null';
        let previewText = escapeHTML(String(displayValue));
         if (isObj && (previewText.startsWith('[object ') || previewText.startsWith('{'))) previewText = '[Object]';
         if (r.type === 'function') previewText = '[Function]';

        const testDataIcon = r.isTestData ? '<span class="test-data-icon" title="Test/Debug data">🧪</span>' : '';
        const expandSpan = isObj ? '<span class="ds-expand" tabindex="0" role="button" aria-label="Expand object" title="Expand or collapse this object"></span>' : '';
        row.innerHTML = `
          <td>${i + 1}</td>
          <td class="path-cell" title="${escapeHTML(displayPath)}">${testDataIcon}${expandSpan}${escapeHTML(displayPath)}</td>
          <td>${r.type}</td>
          <td class="preview-cell"><span title="${previewText}">${previewText.slice(0, 60)}</span></td>
          <td>
            <span class="ds-pathcopy" data-path="${escapeHTML(fullPath)}" tabindex="0" role="button" aria-label="Copy path" title="Copy path to clipboard"></span>
            <span class="ds-copy" data-idx="${i}" tabindex="0" role="button" aria-label="Copy value" title="Copy value to clipboard"></span>
            ${isObj ? `<span class="ds-explore" data-idx="${i}" tabindex="0" role="button" aria-label="Explore this object" title="Set as search scope and explore"></span>` : ''}
          </td>
        `;

        // Copy path functionality
        row.querySelector('.ds-pathcopy').addEventListener('click', () => {
          try {
            navigator.clipboard.writeText(fullPath).catch(() => {
              fallbackCopyText(fullPath);
            });
          } catch (e) {
            fallbackCopyText(fullPath);
          }
        });

        // Copy value functionality
        row.querySelector('.ds-copy').addEventListener('click', () => {
          let value = results[i].originalValue || results[i].value;
          
          // If it's a serialized object, try to format it nicely
          if (typeof value === 'string' && (value.startsWith('{') || value.startsWith('['))) {
            try {
              const parsed = JSON.parse(value);
              value = JSON.stringify(parsed, null, 2);
            } catch (e) {
              // Keep original if parsing fails
            }
          }
          
          try {
            navigator.clipboard.writeText(String(value)).catch(() => {
              fallbackCopyText(String(value));
            });
          } catch (e) {
            fallbackCopyText(String(value));
          }
        });

        // Expand functionality for objects
        if (isObj) {
          const expandBtn = row.querySelector('.ds-expand');
          expandBtn.addEventListener('click', () => toggleExpand(row, fullPath, results[i]));
          expandBtn.addEventListener('keydown', e => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              toggleExpand(row, fullPath, results[i]);
            }
          });

          // Explore functionality
          const exploreBtn = row.querySelector('.ds-explore');
          if (exploreBtn) {
            exploreBtn.addEventListener('click', () => exploreObject(fullPath));
            exploreBtn.addEventListener('keydown', e => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                exploreObject(fullPath);
              }
            });
          }
        }
        return row;
    }

    function toggleExpand(row, objectPath, resultItem) {
        const expandBtn = row.querySelector('.ds-expand');
        if (expandBtn.classList.contains('expanded')) {
            // Collapse - remove expanded content
            expandBtn.classList.remove('expanded');
            if (row.expandedSubRow) {
                row.expandedSubRow.remove();
                delete row.expandedSubRow;
            }
            row.removeAttribute('data-expanded-path');
        } else {
            // Expand - request object properties from the page
            expandBtn.classList.add('expanded');
            row.setAttribute('data-expanded-path', objectPath);
            statusDiv.textContent = 'Expanding object...';
            
            // Send message to get object properties using port
            if (!port) connect();
            port.postMessage({
                tabId: chrome.devtools.inspectedWindow.tabId,
                action: 'getObjectProperties',
                payload: { path: objectPath }
            });
        }
    }

    function displayObjectProperties(row, properties) {
        // Remove any existing expanded content
        if (row.expandedSubRow) {
            row.expandedSubRow.remove();
            delete row.expandedSubRow;
        }

        const subRow = document.createElement('tr');
        const subTd = document.createElement('td');
        subTd.colSpan = 5;
        subTd.style.paddingLeft = '20px';
        subTd.style.backgroundColor = '#f9f9f9';
        subTd.style.borderLeft = '2px solid #007bff';
        
        if (properties.length === 0) {
            subTd.innerHTML = '<em>No enumerable properties found</em>';
        } else {
            const subTable = document.createElement('table');
            subTable.style.width = '100%';
            subTable.innerHTML = '<thead><tr><th>#</th><th>Path</th><th>Type</th><th>Preview</th><th>Actions</th></tr></thead>';
            const subTbody = document.createElement('tbody');
            
            properties.forEach((prop, i) => {
                const subRow = createResultRow(prop, i, properties);
                // Add additional copy functionality for property values
                const copyBtn = subRow.querySelector('.ds-copy');
                if (copyBtn) {
                    copyBtn.addEventListener('click', () => {
                        let textToCopy = prop.originalValue || prop.value;
                        
                        // If it's a serialized object, try to format it nicely
                        if (typeof textToCopy === 'string' && (textToCopy.startsWith('{') || textToCopy.startsWith('['))) {
                            try {
                                const parsed = JSON.parse(textToCopy);
                                textToCopy = JSON.stringify(parsed, null, 2);
                            } catch (e) {
                                // Keep original if parsing fails
                            }
                        }
                        
                        try {
                            navigator.clipboard.writeText(String(textToCopy)).catch(() => {
                                fallbackCopyText(String(textToCopy));
                            });
                        } catch (e) {
                            fallbackCopyText(String(textToCopy));
                        }
                    });
                }
                subTbody.appendChild(subRow);
            });
            
            subTable.appendChild(subTbody);
            subTd.appendChild(subTable);
        }
        
        subRow.appendChild(subTd);
        row.parentNode.insertBefore(subRow, row.nextSibling);
        row.expandedSubRow = subRow;
    }

    function exploreObject(objectPath) {
        const term = $('ds-term').value.trim();
        if (!term) {
            statusDiv.textContent = 'Please enter a search term first.';
            return;
        }

        loader.style.display = 'block';
        stopButton.style.display = 'block';
        statusDiv.textContent = 'Exploring object...';
        currentResults = [];
        filteredResults = [];
        initializeResultsTable();

        // Send message to explore the specific object
        chrome.tabs.sendMessage(chrome.devtools.inspectedWindow.tabId, {
            action: "exploreObject",
            payload: {
                path: objectPath,
                term: term,
                options: {
                    mode: $('ds-mode').value,
                    matchType: $('ds-match').value,
                    maxDepth: parseInt($('ds-depth').value, 10)
                }
            }
        }, (response) => {
            if (chrome.runtime.lastError || !response || !response.success) {
                statusDiv.textContent = 'Error exploring object.';
                loader.style.display = 'none';
                stopButton.style.display = 'none';
            }
            // Results will come through the normal updateResults message
        });
    }

    function renderResults(results) {
        initializeResultsTable();
        appendResults(results, true);
    }

    function populateTypeFilter(types) {
        typeFilter.innerHTML = '<option value="all" selected>All Types</option>';
        types.forEach(t => {
            const option = document.createElement('option');
            option.value = t;
            option.textContent = t[0].toUpperCase() + t.slice(1);
            typeFilter.appendChild(option);
        });
        typeFilter.style.display = types.length > 0 ? 'block' : 'none';
    }


    // --- COMMUNICATION & EVENT LISTENERS ---

    // Listen for results and status updates from the content script
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        // Process chunked messages first
        const processedMessage = processChunkedMessage(message);
        
        // If message is incomplete (part of a chunk), just acknowledge and wait for more
        if (!processedMessage) {
            sendResponse({ success: true });
            return true;
        }
        
        // Use the processed message for handling
        const { action, payload } = processedMessage;
        
        if (action === 'updateStatus') {
            statusDiv.textContent = payload;
        } else if (action === 'updateResults') {
            const { results = [], isFinal, skipped } = payload || {};
            currentResults = results; // Keep a full copy of the latest results
            appendResults(results, isFinal);

            if (isFinal) {
                loader.style.display = 'none';
                stopButton.style.display = 'none';
                let statusText = `Search complete. Found ${results.length} results.`;
                if (skipped && skipped > 0) {
                    statusText += ` (${skipped} test/debug paths skipped)`;
                }
                statusDiv.textContent = statusText;
                const uniqueTypes = Array.from(new Set(results.map(r => r.type))).sort();
                populateTypeFilter(uniqueTypes);
                // Update filter to show current results
                typeFilter.dispatchEvent(new Event('change'));
            }
        } else if (action === 'exploreResults') {
            // Handle exploration results
            const { results = [], isFinal, basePath } = payload || {};
            if (isFinal) {
                statusDiv.textContent = `Exploration of ${basePath} complete. Found ${results.length} results.`;
                // You could display these results in a separate section or replace current results
                currentResults = results;
                initializeResultsTable();
                appendResults(results, true);
                const uniqueTypes = Array.from(new Set(results.map(r => r.type))).sort();
                populateTypeFilter(uniqueTypes);
                typeFilter.dispatchEvent(new Event('change'));
            } else {
                statusDiv.textContent = `Exploring ${basePath}... Found ${results.length} results so far.`;
            }
        } else if (action === 'updateStatus') {
            // Handle status updates
            statusDiv.textContent = payload;
        } else if (action === 'searchPartial') {
            // Handle partial search results
            const { results = [], processed, remaining } = payload || {};
            
            if (processed !== undefined) {
                statusDiv.textContent = `Searching... Found ${results.length} results. Processed: ${processed}, Remaining: ${remaining}`;
            }
            
            currentResults = results;
            initializeResultsTable();
            appendResults(results, false);
        } else if (action === 'searchComplete') {
            // Handle search completion
            const results = payload || [];
            loader.style.display = 'none';
            stopButton.style.display = 'none';
            statusDiv.textContent = `Search complete. Found ${results.length} results.`;
            currentResults = results;
            initializeResultsTable();
            appendResults(results, true);
            
            // Update type filter
            const uniqueTypes = Array.from(new Set(results.map(r => r.type))).sort();
            populateTypeFilter(uniqueTypes);
            typeFilter.dispatchEvent(new Event('change'));
        } else if (action === 'searchCancelled') {
            // Handle search cancellation
            const { results = [], reason, processed } = payload || {};
            
            loader.style.display = 'none';
            stopButton.style.display = 'none';
            
            if (reason === 'cancelled') {
                statusDiv.textContent = `Search cancelled. Found ${results.length} results before cancellation.`;
                
                // Still show partial results if any were found
                if (results && results.length > 0) {
                    currentResults = results;
                    initializeResultsTable();
                    appendResults(results, true);
                    
                    const uniqueTypes = Array.from(new Set(results.map(r => r.type))).sort();
                    populateTypeFilter(uniqueTypes);
                    typeFilter.dispatchEvent(new Event('change'));
                }
            } else {
                // Handle other cancellation reasons
                const reasonText = reason || 'unknown reason';
                statusDiv.textContent = `Search cancelled (${reasonText}). Found ${results.length} results before cancellation.`;
                
                // Still show partial results if any were found
                if (results && results.length > 0) {
                    currentResults = results;
                    initializeResultsTable();
                    appendResults(results, true);
                    
                    const uniqueTypes = Array.from(new Set(results.map(r => r.type))).sort();
                    populateTypeFilter(uniqueTypes);
                    typeFilter.dispatchEvent(new Event('change'));
                }
            }
        }
        // Always send a response to prevent the message port from closing prematurely
        sendResponse({ success: true });
        return true; // Indicates that sendResponse will be called asynchronously
    });

    // Utility function to check extension context
    function checkExtensionContext() {
        if (!chrome || !chrome.runtime || !chrome.runtime.id) {
            statusDiv.textContent = 'Error: Extension context invalidated. Please reload the extension or DevTools.';
            return false;
        }
        if (window.location.protocol === 'devtools:') {
            statusDiv.textContent = 'Error: This extension cannot be used within DevTools itself. Please navigate to a web page in the inspected tab.';
            return false;
        }
        
        // Validate that we have a valid tab ID
        const tabId = chrome.devtools.inspectedWindow.tabId;
        if (!tabId || tabId < 0) {
            statusDiv.textContent = 'Error: No valid tab to inspect. Please ensure DevTools is attached to a web page.';
            return false;
        }
        
        // Log the tab ID for debugging
        console.log('Deep Search targeting tab ID:', tabId);
        return true;
    }

    // Handle the main search form submission
    form.addEventListener('submit', (e) => {
        e.preventDefault();
        const term = $('ds-term').value.trim();
        if (!term) return;

        if (!checkExtensionContext()) return;

        loader.style.display = 'block';
        stopButton.style.display = 'block';
        statusDiv.textContent = 'Preparing search...';
        currentResults = [];
        filteredResults = [];
        initializeResultsTable();

        // First, check if the inspected page is compatible
        try {
            chrome.devtools.inspectedWindow.eval('location.href', (url, isException) => {
                if (isException || !url) {
                    statusDiv.textContent = 'Error: Could not determine page URL.';
                    loader.style.display = 'none';
                    stopButton.style.display = 'none';
                    return;
                }

                if (url.startsWith('chrome://') || url.startsWith('devtools://') || url.startsWith('chrome-extension://')) {
                    statusDiv.textContent = 'Error: This extension cannot be used on Chrome internal pages, DevTools, or extension pages. Please navigate to a standard web page.';
                    loader.style.display = 'none';
                    stopButton.style.display = 'none';
                    return;
                }

                // Proceed with readiness check
                const checkReadinessAndSearch = (retryCount = 0) => {
                    if (!checkExtensionContext()) return;

                    const tabId = chrome.devtools.inspectedWindow.tabId;
                    console.log(`Attempting to connect to tab ${tabId} (attempt ${retryCount + 1})`);

                    chrome.tabs.sendMessage(tabId, {
                        action: "ping"
                    }, (response) => {
                        if (chrome.runtime.lastError || !response || !response.success) {
                            const errorMsg = chrome.runtime.lastError?.message || 'No response';
                            
                            if (!errorMsg.includes('Receiving end does not exist')) {
                                console.error(`Content script not ready on tab ${tabId}:`, errorMsg);
                            }
                            
                            // Retry up to 3 times with increasing delays
                            if (retryCount < 3) {
                                statusDiv.textContent = `Connecting to page... (attempt ${retryCount + 1}/3)`;
                                setTimeout(() => checkReadinessAndSearch(retryCount + 1), 500 * (retryCount + 1));
                                return;
                            }
                            
                            statusDiv.textContent = `Error: Could not connect to page. Please refresh the page and try again. (Tab ID: ${tabId})`;
                            loader.style.display = 'none';
                            stopButton.style.display = 'none';
                            return;
                        }
                        
                        // Content script is ready, send the search message
                        if (!checkExtensionContext()) return;

                        console.log(`Successfully connected to tab ${tabId}, starting search`);
                        chrome.tabs.sendMessage(tabId, {
                            action: "executeSearch",
                            payload: {
                                term: term,
                                maxDepth: parseInt($('ds-depth').value, 10),
                                maxResults: 10000,
                                mode: $('ds-mode').value,
                                matchType: $('ds-match').value
                            }
                        }, (response) => {
                            if (chrome.runtime.lastError) {
                                const errorMsg = chrome.runtime.lastError.message;
                                console.error('Error sending search message:', errorMsg);
                                
                                // Provide more specific error messages
                                if (errorMsg.includes('message channel closed')) {
                                    statusDiv.textContent = 'Error: Communication lost with page. Please refresh the page and try again.';
                                } else if (errorMsg.includes('Receiving end does not exist')) {
                                    statusDiv.textContent = 'Error: Content script not loaded. Please refresh the page and try again.';
                                } else {
                                    statusDiv.textContent = `Error: Failed to start search - ${errorMsg}`;
                                }
                                
                                loader.style.display = 'none';
                                stopButton.style.display = 'none';
                            } else if (response && response.success) {
                                // Search initiated successfully
                                statusDiv.textContent = 'Search started...';
                                console.log(`Search started successfully on tab ${tabId}`);
                            } else {
                                // Unexpected response
                                statusDiv.textContent = 'Error: Unexpected response from content script.';
                                loader.style.display = 'none';
                                stopButton.style.display = 'none';
                            }
                        });
                    });
                };
                
                checkReadinessAndSearch();
            });
        } catch (error) {
            statusDiv.textContent = 'Error: Extension context invalidated. Please reload the extension or DevTools.';
            loader.style.display = 'none';
            stopButton.style.display = 'none';
        }
    });

    // Cleanup function to stop all processes
    function performCleanup(reason = 'stopped') {
        console.log(`Performing cleanup: ${reason}`);
        
        // Send cancel message to the active tab if extension context is valid
        if (chrome && chrome.runtime && chrome.runtime.id && chrome.devtools && chrome.devtools.inspectedWindow) {
            try {
                const tabId = chrome.devtools.inspectedWindow.tabId;
                if (tabId && tabId > 0) {
                    chrome.tabs.sendMessage(tabId, {
                        action: "cancelSearch"
                    }, (response) => {
                        if (chrome.runtime.lastError) {
                            const errorMsg = chrome.runtime.lastError.message;
                            if (!errorMsg.includes('Receiving end does not exist')) {
                                console.log('Cleanup: Error sending cancel message:', errorMsg);
                            }
                        } else {
                            console.log('Cleanup: Cancel message sent successfully');
                        }
                    });
                }
            } catch (error) {
                console.log('Cleanup: Extension context no longer valid:', error.message);
            }
        }
        
        // Reset UI state
        loader.style.display = 'none';
        stopButton.style.display = 'none';
        
        // Update status based on reason
        if (reason === 'devtools_closed') {
            statusDiv.textContent = 'DevTools closed - all processes stopped.';
        } else if (reason === 'page_unload') {
            statusDiv.textContent = 'Page unloaded - search stopped.';
        } else {
            statusDiv.textContent = 'Search cancelled.';
        }
        
        // Clear any pending timeouts or intervals if they exist
        // (This would be expanded if we had any timers to clear)
    }

    // Handle Stop Button
    stopButton.addEventListener('click', () => {
        performCleanup('user_stopped');
    });

    // Handle DevTools/Panel lifecycle events
    window.addEventListener('beforeunload', () => {
        console.log('DevTools panel beforeunload event');
        performCleanup('devtools_closed');
    });

    window.addEventListener('unload', () => {
        console.log('DevTools panel unload event');
        performCleanup('devtools_closed');
    });

    // Handle page navigation/refresh in the inspected window
    if (chrome.devtools && chrome.devtools.network) {
        chrome.devtools.network.onNavigated.addListener(() => {
            console.log('Inspected page navigated');
            performCleanup('page_navigated');
        });
    }

    // Handle extension context invalidation
    window.addEventListener('error', (event) => {
        if (event.error && event.error.message && 
            (event.error.message.includes('Extension context invalidated') || 
             event.error.message.includes('chrome.runtime.id'))) {
            console.log('Extension context invalidated');
            performCleanup('extension_invalidated');
        }
    });

    // Handle Type Filter
    typeFilter.addEventListener('change', () => {
        const filterVal = typeFilter.value;
        if (filterVal === 'all') {
            filteredResults = currentResults;
        } else {
            filteredResults = currentResults.filter(r => r.type === filterVal);
        }
        renderResults(filteredResults);
    });

    // Establish connection when panel loads
    connect();

    // Handle Exports
    exportJsonButton.addEventListener('click', () => {
        const exportData = filteredResults.length ? filteredResults : currentResults;
        if (!exportData || exportData.length === 0) return;
        const blob = new Blob([safeStringify(exportData, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'deep_search_results.json';
        a.click();
        URL.revokeObjectURL(url);
    });

    exportCsvButton.addEventListener('click', () => {
        const exportData = filteredResults.length ? filteredResults : currentResults;
        if (!exportData || exportData.length === 0) return;
        const rows = [['Index', 'Path', 'Type', 'Value']];
        exportData.forEach((r, i) => rows.push([i + 1, r.path, r.type, safeStringify(r.originalValue || r.value)]));
        const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'deep_search_results.csv';
        a.click();
        URL.revokeObjectURL(url);
    });
});