const root = document.getElementById('root');

root.innerHTML = `
  <div id="deepSearchUI">
    <header>
      <span>JS Deep Search</span>
    </header>
    <form>
      <div class="search-row">
        <input type="text" placeholder="Enter search term..." id="ds-term" required aria-label="Search term" />
        <div class="filter-container" id="filter-container" style="display: none;">
          <select id="ds-type-filter" aria-label="Filter by type">
            <option value="">All types</option>
          </select>
          <span id="filter-count"></span>
        </div>
      </div>
      <div class="search-scope" style="display: none;">
        <input type="text" id="search-scope" placeholder="Search scope..." readonly aria-label="Current search scope" />
        <button type="button" id="clear-scope" style="display: none;">Clear Scope</button>
      </div>
      <div class="dropdown-row">
        <select id="ds-mode" aria-label="Search mode">
          <option value="both">Search in keys and values</option>
          <option value="key">Search in keys only</option>
          <option value="value">Search in values only</option>
        </select>
        <select id="ds-match" aria-label="Match type">
          <option value="partial">Partial match</option>
          <option value="full">Full match</option>
        </select>
        <select id="ds-depth" aria-label="Search depth">
          <option value="2">Fast (Depth 2)</option>
          <option value="5" selected>Deep (Depth 5)</option>
          <option value="10">Deeper (Depth 10)</option>
          <option value="20">Deepest (Depth 20)</option>
          <option value="50">Crazy Fool (Depth 50)</option>
        </select>
      </div>
      <div class="button-row">
        <button type="submit">Search</button>
        <button type="button" id="ds-stop" style="background: #dc3545; display: none;">Stop Search</button>
        <button type="button" id="ds-reconnect" style="background: #28a745; display: none;">Reconnect</button>
        <button type="button" id="ds-export-json" class="export" disabled>Export JSON</button>
        <button type="button" id="ds-export-csv" class="export" disabled>Export CSV</button>
      </div>
    </form>
    <div class="loader" style="display: none;"></div>
    <div id="ds-status" style="text-align: center; margin: 10px auto; font-style: italic; color: #666;white-space:nowrap;max-width:95%;overflow:hidden;"></div>
    <div id="deepSearchResults" aria-live="polite" aria-relevant="additions"></div>
  </div>
`;

// Global variables
let port = null;
let connectionEstablished = false;
let currentResults = [];
let allResults = [];
let instanceId = Math.random().toString(36).substr(2, 9);

// DOM Element Cache for performance optimization
const DOMCache = {
  elements: new Map(),
  
  get(id) {
    if (!this.elements.has(id)) {
      const element = document.getElementById(id);
      if (element) {
        this.elements.set(id, element);
      }
      return element;
    }
    return this.elements.get(id);
  },
  
  clear() {
    this.elements.clear();
  },
  
  // Preload commonly used elements
  preload() {
    const commonIds = [
      'deepSearchUI', 'ds-status', 'ds-stop', 'ds-reconnect', 'deepSearchResults',
      'ds-type-filter', 'filter-container', 'filter-count',
      'ds-export-json', 'ds-export-csv', 'search-scope', 'clear-scope'
    ];
    commonIds.forEach(id => this.get(id));
  },
  
  clear() {
    this.elements.clear();
  }
};

// Helper function to get elements by ID (optimized with caching)
function $(id) {
  return DOMCache.get(id);
}

// Event Listener Manager for proper cleanup
const EventManager = {
  listeners: new Map(),
  
  add(element, event, handler, options = {}) {
    if (!element) return;
    
    const key = `${element.id || element.tagName}_${event}_${Date.now()}_${Math.random()}`;
    element.addEventListener(event, handler, options);
    
    this.listeners.set(key, { element, event, handler, options });
    return key;
  },
  
  remove(key) {
    const listener = this.listeners.get(key);
    if (listener) {
      listener.element.removeEventListener(listener.event, listener.handler, listener.options);
      this.listeners.delete(key);
    }
  },
  
  removeForElement(element) {
    // Remove all listeners for a specific element
    for (const [key, listener] of this.listeners.entries()) {
      if (listener.element === element) {
        listener.element.removeEventListener(listener.event, listener.handler, listener.options);
        this.listeners.delete(key);
      }
    }
  },
  
  removeAll() {
    this.listeners.forEach((listener, key) => {
      try {
        listener.element.removeEventListener(listener.event, listener.handler, listener.options);
      } catch (e) {
        // Ignore errors for elements that may have been removed from DOM
      }
    });
    this.listeners.clear();
  },
  
  // Get count of active listeners (for debugging)
  getCount() {
    return this.listeners.size;
  }
};

// Utility Functions
const Utils = {
  // Optimized copy functionality
  copyToClipboard(text, fallback = true) {
    console.log('Attempting to copy to clipboard:', text);
    
    // In DevTools context, clipboard API is often restricted, so prefer fallback
    const isDevToolsContext = window.location.protocol === 'chrome-extension:';
    
    // Check if we're in a secure context and clipboard API is available
    if (!navigator.clipboard || isDevToolsContext) {
      //console.warn('Clipboard API not available or in DevTools context, using fallback');
      if (fallback) this.fallbackCopy(text);
      return Promise.resolve();
    }
    
    try {
      return navigator.clipboard.writeText(text).then(() => {
        console.log('Successfully copied to clipboard');
        // Show a brief success message
        const statusElement = $('ds-status');
        if (statusElement) {
          const originalText = statusElement.textContent;
          statusElement.textContent = 'Copied to clipboard!';
          setTimeout(() => {
            statusElement.textContent = originalText;
          }, 1500);
        }
      }).catch((error) => {
        console.warn('Clipboard API failed:', error);
        if (fallback) this.fallbackCopy(text);
      });
    } catch (e) {
      console.warn('Clipboard API error:', e);
      if (fallback) this.fallbackCopy(text);
      return Promise.resolve();
    }
  },
  
  fallbackCopy(text) {
    console.log('Using fallback copy method for:', text);
    
    // Create a more robust fallback for DevTools context
    const textArea = document.createElement('textarea');
    textArea.value = text;
    
    // Style the textarea to be invisible but still focusable
    Object.assign(textArea.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      width: '2em',
      height: '2em',
      padding: '0',
      border: 'none',
      outline: 'none',
      boxShadow: 'none',
      background: 'transparent',
      opacity: '0',
      zIndex: '-1'
    });
    
    document.body.appendChild(textArea);
    
    // Focus and select the text
    textArea.focus();
    textArea.select();
    textArea.setSelectionRange(0, 99999); // For mobile devices
    
    try {
      const successful = document.execCommand('copy');
      if (successful) {
        console.log('Fallback copy successful');
        // Show success message
        const statusElement = $('ds-status');
        if (statusElement) {
          const originalText = statusElement.textContent;
          statusElement.textContent = 'Copied to clipboard!';
          setTimeout(() => {
            statusElement.textContent = originalText;
          }, 1500);
        }
      } else {
        console.error('Fallback copy failed: execCommand returned false');
        this.showCopyError();
      }
    } catch (err) {
      console.error('Fallback copy failed:', err);
      this.showCopyError();
    } finally {
      document.body.removeChild(textArea);
    }
  },
  
  showCopyError() {
    // Show error message
    const statusElement = $('ds-status');
    if (statusElement) {
      const originalText = statusElement.textContent;
      statusElement.textContent = 'Copy failed - please select and copy manually';
      setTimeout(() => {
        statusElement.textContent = originalText;
      }, 3000);
    }
  },
  
  // Optimized HTML escaping
  escapeHTML(str) {
    const escapeMap = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    };
    return str.toString().replace(/[&<>"']/g, char => escapeMap[char]);
  },
  
  // Debounced function execution
  debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  },
  
  // Safe error handling with extension context validation
  safeExecute(fn, errorMessage = 'Operation failed') {
    try {
      // Check if we're in a valid extension context before executing
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) {
        return fn();
      } else if (typeof chrome !== 'undefined' && chrome.runtime && !chrome.runtime.id) {
        // Extension context is invalidated
        console.warn('Extension context invalidated, cannot execute operation');
        $('ds-status').textContent = 'Extension context invalidated. Please reload the DevTools.';
        return null;
      } else {
        // Not in extension context (preview mode)
        return fn();
      }
    } catch (error) {
      console.error(errorMessage, error);
      if (error.message && error.message.includes('Extension context invalidated')) {
        $('ds-status').textContent = 'Extension context invalidated. Please reload the DevTools.';
      } else {
        $('ds-status').textContent = `${errorMessage}: ${error.message}`;
      }
      return null;
    }
  },

  // Check if extension context is valid
  isExtensionContextValid() {
    try {
      return !!(typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id);
    } catch (error) {
      return false;
    }
  }
};

function connect() {
  if (connectionEstablished) return;
  
  // Check extension context before attempting connection
  if (!Utils.isExtensionContextValid()) {
    console.warn('Cannot connect: Extension context is not valid');
    $('ds-status').textContent = 'Extension context invalidated. Attempting to recover...';
    
    // Try to recover by reloading the extension context
    setTimeout(() => {
      if (Utils.isExtensionContextValid()) {
        console.log('Extension context recovered, attempting reconnection');
        connect();
      } else {
        $('ds-status').textContent = 'Extension context invalidated. Please reload the DevTools.';
        $('ds-reconnect').style.display = 'inline-block';
      }
    }, 1000);
    return;
  }
  
  Utils.safeExecute(() => {
    // Double-check we're in a Chrome extension context
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) {
      try {
        port = chrome.runtime.connect({ name: 'devtools-page' });
        
        // Validate port was created successfully
        if (!port) {
          throw new Error('Failed to create connection port');
        }
        
        port.postMessage({ 
          name: 'init', 
          tabId: chrome.devtools.inspectedWindow.tabId,
          instanceId: instanceId
        });

        port.onMessage.addListener(function (msg) {
          Utils.safeExecute(() => {
            if (msg.action === 'search_results') {
              renderResults(msg.results, msg.isDone);
            } else if (msg.action === 'status') {
              $('ds-status').textContent = msg.data;
            } else if (msg.action === 'objectProperties') {
              handleObjectProperties(msg.path, msg.properties, msg.success, msg.warning);
            }
          }, 'Error processing message');
        });

        port.onDisconnect.addListener(() => {
          console.log('Port disconnected, checking for extension context invalidation');
          connectionEstablished = false;
          port = null;
          
          // Check if disconnect was due to extension context invalidation
          if (chrome.runtime.lastError) {
            console.warn('Extension disconnected:', chrome.runtime.lastError.message);
            $('ds-status').textContent = 'Connection lost. Attempting to reconnect...';
            
            // Attempt automatic reconnection after a delay
             setTimeout(() => {
               if (Utils.isExtensionContextValid()) {
                 connect();
               } else {
                 $('ds-status').textContent = 'Connection lost. Please reload the DevTools.';
                 $('ds-reconnect').style.display = 'inline-block';
               }
             }, 2000);
            return;
          }
          
          // Normal disconnect - don't immediately show error, user might be navigating
          setTimeout(() => {
            if (!connectionEstablished && Utils.isExtensionContextValid()) {
              $('ds-status').textContent = 'Connection lost. Attempting to reconnect...';
              // Try to reconnect after a delay
              setTimeout(() => {
                if (Utils.isExtensionContextValid()) {
                  connect();
                } else {
                  cleanup(true);
                  $('ds-reconnect').style.display = 'inline-block';
                }
              }, 2000);
            }
          }, 1000);
        });
        
        connectionEstablished = true;
        console.log('Successfully connected to extension');
        
        // Clear any previous error messages
        if ($('ds-status').textContent.includes('Connection') || 
            $('ds-status').textContent.includes('Extension context') ||
            $('ds-status').textContent.includes('failed') ||
            $('ds-status').textContent.includes('Retrying')) {
          $('ds-status').textContent = 'Connected. Ready to search.';
        }
        
        $('ds-reconnect').style.display = 'none';
      } catch (error) {
        console.warn('Failed to connect to extension:', error.message);
        $('ds-status').textContent = 'Connection failed. Retrying...';
        connectionEstablished = false;
        port = null;
        
        // Only retry if extension context is still valid
        if (Utils.isExtensionContextValid()) {
          setTimeout(() => {
            if (Utils.isExtensionContextValid()) {
              console.log('Retrying connection...');
              connect();
            }
          }, 3000);
        } else {
          $('ds-status').textContent = 'Connection failed. Please reload the DevTools.';
          $('ds-reconnect').style.display = 'inline-block';
        }
        return;
      }
    } else {
      // We're not in a Chrome extension context (e.g., local preview)
      console.log('Not in Chrome extension context, skipping connection');
      $('ds-status').textContent = 'Preview mode: Extension features not available';
      return;
    }
  }, 'Failed to establish connection');
}

function cleanup(preserveResults = false) {
  // Reset connection state
  connectionEstablished = false;
  port = null;
  
  if (!preserveResults) {
    // Clear results only if not preserving them
    currentResults = [];
    allResults = [];
    
    const resultsContainer = $('deepSearchResults');
    if (resultsContainer) {
      resultsContainer.innerHTML = '';
    }
    
    const exportJsonBtn = $('ds-export-json');
    if (exportJsonBtn) exportJsonBtn.disabled = true;
    
    const exportCsvBtn = $('ds-export-csv');
    if (exportCsvBtn) exportCsvBtn.disabled = true;
    
    const filterContainer = $('filter-container');
    if (filterContainer) filterContainer.style.display = 'none';
    
    const statusElement = $('ds-status');
    if (statusElement) statusElement.textContent = '';
  } else {
    // Show reconnection message
    const statusElement = $('ds-status');
    if (statusElement) {
      statusElement.textContent = 'Connection lost. Attempting to reconnect...';
    }
    
    // Attempt to reconnect after a short delay
    setTimeout(connect, 1000);
  }
  
  // Clean up event listeners
  EventManager.removeAll();
  
  console.log('Panel cleaned up for instance:', instanceId, 'preserveResults:', preserveResults);
}

// Initialize the application
function initializeApp() {
  // Preload DOM elements for better performance
  DOMCache.preload();
  
  // Set up main event listeners with proper management
  const form = $('deepSearchUI')?.querySelector('form');
  if (form) {
    EventManager.add(form, 'submit', handleFormSubmit);
  }
  
  const stopButton = $('ds-stop');
  if (stopButton) {
    EventManager.add(stopButton, 'click', handleStopSearch);
  }
  
  const reconnectButton = $('ds-reconnect');
  if (reconnectButton) {
    EventManager.add(reconnectButton, 'click', handleReconnect);
  }
  
  const typeFilter = $('ds-type-filter');
  if (typeFilter) {
    EventManager.add(typeFilter, 'change', Utils.debounce(handleTypeFilterChange, 100));
  }
  
  const exportJsonButton = $('ds-export-json');
  if (exportJsonButton) {
    EventManager.add(exportJsonButton, 'click', handleExportJson);
  }
  
  const exportCsvButton = $('ds-export-csv');
  if (exportCsvButton) {
    EventManager.add(exportCsvButton, 'click', handleExportCsv);
  }
}

// Event Handlers (extracted for better organization)
function handleFormSubmit(e) {
  e.preventDefault();
  
  // Check if we're in a valid Chrome extension context
  if (!Utils.isExtensionContextValid()) {
    $('ds-status').textContent = 'Extension context invalidated. Attempting to recover...';
    
    // Try to recover and then start search
    setTimeout(() => {
      if (Utils.isExtensionContextValid()) {
        console.log('Extension context recovered, attempting search');
        handleFormSubmit(e); // Retry the search
      } else {
        $('ds-status').textContent = 'Extension context invalidated. Please reload the DevTools.';
      }
    }, 1000);
    return;
  }
  
  // Try to connect if not already connected
  if (!port || !connectionEstablished) {
    $('ds-status').textContent = 'Establishing connection...';
    connect();
    
    // Give connection more time to establish and retry
    setTimeout(() => {
      if (port && connectionEstablished) {
        performSearch();
      } else {
        $('ds-status').textContent = 'Failed to establish connection. Please try again or reload the DevTools.';
      }
    }, 2000);
    return;
  }
  
  performSearch();
}

function performSearch() {
  // Ensure we still have a valid connection
  if (!port) {
    $('ds-status').textContent = 'No connection available. Attempting to reconnect...';
    connect();
    // Retry the search after a short delay
    setTimeout(() => {
      if (port && connectionEstablished) {
        performSearch();
      } else {
        $('ds-status').textContent = 'Connection failed. Please reload the page or DevTools.';
      }
    }, 1000);
    return;
  }
  
  // Reset state for new search
  currentResults = [];
  allResults = [];
  $('deepSearchResults').innerHTML = '';
  $('ds-export-json').disabled = true;
  $('ds-export-csv').disabled = true;
  $('filter-container').style.display = 'none';

  const term = $('ds-term').value;
  const options = {
    mode: $('ds-mode').value,
    matchType: $('ds-match').value,
    maxDepth: parseInt($('ds-depth').value, 10),
    instanceId: instanceId,
    scope: window.searchScope || null // Include search scope if set
  };

  $('ds-status').textContent = 'Starting search...';
  $('ds-stop').style.display = 'block';

  try {
    port.postMessage({ 
      tabId: chrome.devtools.inspectedWindow.tabId,
      action: 'search',
      term: term,
      options: options
    });
  } catch (error) {
    console.warn('Failed to send search message:', error.message);
    $('ds-status').textContent = 'Connection issue detected. Attempting to reconnect...';
    
    // Try to reconnect and retry the search
    connectionEstablished = false;
    port = null;
    connect();
    
    // Retry after reconnection
    setTimeout(() => {
      if (port && connectionEstablished) {
        console.log('Retrying search after reconnection');
        try {
          port.postMessage({ 
            tabId: chrome.devtools.inspectedWindow.tabId,
            action: 'search',
            term: term,
            options: options
          });
        } catch (retryError) {
          console.warn('Retry failed:', retryError.message);
          $('ds-status').textContent = 'Connection lost. Please reload the page or DevTools.';
          $('ds-stop').style.display = 'none';
        }
      } else {
        $('ds-status').textContent = 'Connection failed. Please reload the page or DevTools.';
        $('ds-stop').style.display = 'none';
      }
    }, 1500);
  }
}

function handleStopSearch() {
  // Check if we're in a valid Chrome extension context
  if (!Utils.isExtensionContextValid()) {
    $('ds-status').textContent = 'Extension context invalidated. Cannot stop search.';
    $('ds-stop').style.display = 'none';
    return;
  }
  
  // Try to connect if not connected
  if (!port || !connectionEstablished) {
    $('ds-status').textContent = 'No active connection. Search may already be stopped.';
    $('ds-stop').style.display = 'none';
    return;
  }
  
  try {
    port.postMessage({ 
      tabId: chrome.devtools.inspectedWindow.tabId,
      action: 'cancel_search'
    });
    $('ds-status').textContent = 'Search cancelled.';
    $('ds-stop').style.display = 'none';
  } catch (error) {
    console.warn('Failed to send cancel message:', error.message);
    $('ds-status').textContent = 'Search cancelled (connection issue detected).';
    $('ds-stop').style.display = 'none';
    
    // Don't immediately invalidate connection - just log the error
    // The connection might still be valid for new searches
    console.log('Cancel message failed, but keeping connection for retry');
  }
}

function handleReconnect() {
  $('ds-status').textContent = 'Attempting to reconnect...';
  $('ds-reconnect').style.display = 'none';
  
  // Reset connection state
  connectionEstablished = false;
  port = null;
  
  // Attempt to reconnect
  connect();
}

// Debounced filter function to reduce CPU usage
let filterTimeout;
let filteredResultsCache = new Map();

function debouncedFilter() {
  clearTimeout(filterTimeout);
  filterTimeout = setTimeout(() => {
    const selectedType = $('ds-type-filter').value;
    
    if (selectedType) {
      // Use cached filter results if available
      if (!filteredResultsCache.has(selectedType)) {
        filteredResultsCache.set(selectedType, allResults.filter(r => r.type === selectedType));
      }
      currentResults = filteredResultsCache.get(selectedType);
    } else {
      currentResults = allResults;
    }
    
    displayFilteredResults(currentResults);
    updateFilterCount();
  }, 150); // 150ms debounce
}

function handleTypeFilterChange() {
  debouncedFilter();
}

function handleExportJson() {
  const json = JSON.stringify(currentResults, null, 2);
  downloadFile(json, 'js-digger-results.json', 'application/json');
}

function handleExportCsv() {
  let csv = '"Path","Type","Value"\n';
  currentResults.forEach(r => {
    const path = `"${r.path.replace(/"/g, '""')}"`;
    const type = `"${r.type.replace(/"/g, '""')}"`;
    const value = `"${String(r.value).replace(/"/g, '""')}"`;
    csv += `${path},${type},${value}\n`;
  });
  downloadFile(csv, 'js-digger-results.csv', 'text/csv');
}

// Comprehensive cleanup function
function performCleanup() {
  // Clear large data structures
  if (allResults.length > 0) {
    allResults.length = 0;
  }
  if (currentResults.length > 0) {
    currentResults.length = 0;
  }
  
  // Clear caches
  filteredResultsCache.clear();
  DOMCache.clear();
  
  // Clear timeouts
  clearTimeout(filterTimeout);
  
  // Remove all event listeners
  EventManager.removeAll();
  
  // Clear DOM content
  const resultsBox = $('deepSearchResults');
  if (resultsBox) {
    resultsBox.innerHTML = '';
  }
  
  // Force garbage collection hint
  if (window.gc && typeof window.gc === 'function') {
    setTimeout(() => window.gc(), 100);
  }
}

// Cleanup when DevTools panel is closed
window.addEventListener('beforeunload', function() {
  performCleanup();
  cleanup(false); // Don't preserve results when the window is unloaded
});

// Expose function for devtools.js to call
window.establishConnection = function() {
  // Check if we're in a preview environment
  if (window.location.protocol === 'http:' && window.location.hostname === 'localhost') {
    console.log('Preview mode detected, skipping connection');
    $('ds-status').textContent = 'Preview mode: Extension features not available';
    return;
  }
  
  // Check if extension context is valid before attempting connection
  if (!Utils.isExtensionContextValid()) {
    console.warn('Cannot establish connection: Extension context is not valid');
    $('ds-status').textContent = 'Extension context invalidated. Please reload the DevTools.';
    return;
  }
  
  connect();
};

// Initialize the application when the DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeApp);
} else {
  initializeApp();
}

function renderResults(results, isDone) {
  // Check if this is a new search (results array is smaller than before) or continuation
  const isNewSearch = results.length < allResults.length || allResults.length === 0;
  
  if (isNewSearch) {
    // New search - clear everything and start fresh
    allResults = [];
    currentResults = [];
    const resultsBox = $('deepSearchResults');
    resultsBox.innerHTML = '';
    $('filter-container').style.display = 'none';
  }
  
  // Get only the new results that we haven't rendered yet
  const newResults = results.slice(allResults.length);
  
  // Update our stored results
  // Clear previous results and free memory
  if (allResults.length > 0) {
    // Clear large arrays to free memory
    allResults.length = 0;
    currentResults.length = 0;
    
    // Clear filter cache
    filteredResultsCache.clear();
    
    // Force garbage collection hint (if available)
    if (window.gc && typeof window.gc === 'function') {
      setTimeout(() => window.gc(), 100);
    }
  }
  
  allResults = results;
  currentResults = results; // Initially show all results
  
  // Note: localStorage persistence removed to prevent QuotaExceededError with large result sets
  // DevTools extensions don't need persistent storage across sessions
  
  if (isDone) {
    $('ds-stop').style.display = 'none';
    $('ds-status').textContent = `Search finished. Found ${results.length} results.`;
    if (results.length === 0) {
        $('deepSearchResults').innerHTML = '<p>No results found.</p>';
        $('filter-container').style.display = 'none';
        return;
    }
    $('ds-export-json').disabled = results.length === 0;
    $('ds-export-csv').disabled = results.length === 0;
  } else {
    $('ds-status').textContent = `Found ${results.length} results so far...`;
  }
  
  // Always show and populate the type filter when there are results
  if (results.length > 0) {
    populateTypeFilter(results);
    $('filter-container').style.display = 'flex';
  }

  // Only render new results incrementally, unless it's a new search
  if (isNewSearch) {
    displayFilteredResults(currentResults);
  } else {
    appendNewResults(newResults);
  }
}

// New function to append results incrementally without redrawing
function appendNewResults(newResults) {
  if (newResults.length === 0) return;
  
  const resultsBox = $('deepSearchResults');
  let table = resultsBox.querySelector('table');
  
  // If no table exists yet, create the initial structure
  if (!table) {
    table = document.createElement('table');
    table.innerHTML = `
      <thead>
        <tr>
          <th>#</th>
          <th>Path</th>
          <th>Type</th>
          <th>Preview</th>
          <th>Actions</th>
        </tr>
      </thead>
    `;
    const tbody = document.createElement('tbody');
    table.appendChild(tbody);
    resultsBox.appendChild(table);
  }
  
  const tbody = table.querySelector('tbody');
  const startIndex = allResults.length - newResults.length;
  
  // Check if we have an active filter
  const selectedType = $('ds-type-filter').value;
  const filteredNewResults = selectedType ? 
    newResults.filter(r => r.type === selectedType) : 
    newResults;
  
  // Append new results in batches to avoid blocking the UI
  let currentIndex = 0;
  
  function appendBatch() {
    const batchSize = 15; // Smaller batches for better responsiveness
    const endIndex = Math.min(currentIndex + batchSize, filteredNewResults.length);
    
    // Use document fragment for better performance
    const fragment = document.createDocumentFragment();
    
    for (let i = currentIndex; i < endIndex; i++) {
      const originalIndex = allResults.indexOf(filteredNewResults[i]);
      const row = createResultRow(filteredNewResults[i], originalIndex, allResults);
      fragment.appendChild(row);
    }
    
    // Single DOM operation
    tbody.appendChild(fragment);
    
    currentIndex = endIndex;
    
    if (currentIndex < filteredNewResults.length) {
      // Use setTimeout instead of requestAnimationFrame for better control
      setTimeout(appendBatch, 10);
    }
  }
  
  // Start appending
  requestAnimationFrame(appendBatch);
  
  // Update the current results to include the new filtered results
  if (selectedType) {
    currentResults = allResults.filter(r => r.type === selectedType);
  } else {
    currentResults = allResults;
  }
  
  // Update filter count
  updateFilterCount();
}

function populateTypeFilter(results) {
  const typeFilter = $('ds-type-filter');
  const typeCounts = new Map(); // Use Map for better performance
  
  // Single pass to collect types and counts
  for (const result of results) {
    const type = result.type;
    typeCounts.set(type, (typeCounts.get(type) || 0) + 1);
  }
  
  // Clear existing options except "All types"
  typeFilter.innerHTML = '<option value="">All types</option>';
  
  // Add type options sorted alphabetically with counts
  const sortedTypes = Array.from(typeCounts.keys()).sort();
  for (const type of sortedTypes) {
    const option = document.createElement('option');
    option.value = type;
    option.textContent = `${type} (${typeCounts.get(type)})`;
    typeFilter.appendChild(option);
  }
  
  // Update filter count
  updateFilterCount();
}

function updateFilterCount() {
  const filterCount = $('filter-count');
  const selectedType = $('ds-type-filter').value;
  
  if (selectedType) {
    const filteredCount = currentResults.length;
    const totalCount = allResults.length;
    filterCount.textContent = `Showing ${filteredCount} of ${totalCount} results`;
  } else {
    filterCount.textContent = '';
  }
}

function displayFilteredResults(results) {
  const resultsBox = $('deepSearchResults');
  
  if (results.length === 0) {
    resultsBox.innerHTML = '<p>No results match the current filter.</p>';
    return;
  }

  // Performance optimization: For large result sets, implement batched rendering
  const MAX_INITIAL_ROWS = 500; // Reduced from 1000 for better initial performance
  const displayResults = results.length > MAX_INITIAL_ROWS ? results.slice(0, MAX_INITIAL_ROWS) : results;

  // Create table with proper structure
  const table = document.createElement('table');
  table.innerHTML = `
    <thead>
      <tr>
        <th>#</th>
        <th>Path</th>
        <th>Type</th>
        <th>Preview</th>
        <th>Actions</th>
      </tr>
    </thead>
  `;
  
  const tbody = document.createElement('tbody');
  
  // Use setTimeout for better performance with large datasets
  let currentIndex = 0;
  
  function renderBatch() {
    const batchSize = 20; // Reduced batch size for better responsiveness
    const endIndex = Math.min(currentIndex + batchSize, displayResults.length);
    
    // Use document fragment for efficient DOM operations
    const fragment = document.createDocumentFragment();
    
    for (let i = currentIndex; i < endIndex; i++) {
      const row = createResultRow(displayResults[i], i, results);
      fragment.appendChild(row);
    }
    
    // Single DOM operation
    tbody.appendChild(fragment);
    
    currentIndex = endIndex;
    
    if (currentIndex < displayResults.length) {
      // Use setTimeout for better control over execution timing
      setTimeout(renderBatch, 5);
    } else {
      // Add load more button if there are more results
      if (results.length > MAX_INITIAL_ROWS) {
        const loadMoreRow = document.createElement('tr');
        loadMoreRow.innerHTML = `
          <td colspan="5" style="text-align: center; padding: 20px;">
            <button id="load-more-results">
              Load More Results (${results.length - MAX_INITIAL_ROWS} remaining)
            </button>
          </td>
        `;
        tbody.appendChild(loadMoreRow);
        
        // Add click handler for load more button
        const loadMoreBtn = loadMoreRow.querySelector('#load-more-results');
        if (loadMoreBtn) {
          loadMoreBtn.addEventListener('click', () => {
            loadMoreRow.remove();
            const remainingResults = results.slice(MAX_INITIAL_ROWS);
            
            // Load remaining results in batches too
            let remainingIndex = 0;
            function loadRemainingBatch() {
              const batchSize = 20;
              const endIndex = Math.min(remainingIndex + batchSize, remainingResults.length);
              const fragment = document.createDocumentFragment();
              
              for (let i = remainingIndex; i < endIndex; i++) {
                const row = createResultRow(remainingResults[i], MAX_INITIAL_ROWS + i, results);
                fragment.appendChild(row);
              }
              
              tbody.appendChild(fragment);
              remainingIndex = endIndex;
              
              if (remainingIndex < remainingResults.length) {
                setTimeout(loadRemainingBatch, 5);
              }
            }
            loadRemainingBatch();
          });
        }
      }
    }
  }
  
  table.appendChild(tbody);
  resultsBox.innerHTML = '';
  resultsBox.appendChild(table);
  
  // Start rendering
  requestAnimationFrame(renderBatch);
}

function createResultRow(r, i, results) {
  const row = document.createElement('tr');
  
  // Use originalValue for display if available, otherwise fall back to value
  const displayValue = r.originalValue || r.value;
  const fullPath = r.path;
  const displayPath = fullPath.replace(/^window\./, '');
  const isObj = r.type === 'object' && displayValue !== null && displayValue !== 'null';
  let previewText = Utils.escapeHTML(String(displayValue));
  if (isObj && (previewText.startsWith('[object ') || previewText.startsWith('{'))) previewText = '[Object]';
  if (r.type === 'function') previewText = '[Function]';

  const expandSpan = isObj ? '<span class="ds-expand" tabindex="0" role="button" aria-label="Expand object" title="Expand or collapse this object"></span>' : '';
  const exploreSpan = isObj ? '<span class="ds-explore" data-idx="' + i + '" tabindex="0" role="button" aria-label="Explore from here" title="Set as search scope and explore"></span>' : '';
  
  row.innerHTML = `
    <td>${i + 1}</td>
    <td class="path-cell" title="${Utils.escapeHTML(displayPath)}">${expandSpan}${Utils.escapeHTML(displayPath)}</td>
    <td>${r.type}</td>
    <td class="preview-cell"><span title="${previewText}">${previewText.slice(0, 60)}</span></td>
    <td>
      <span class="ds-pathcopy" data-path="${Utils.escapeHTML(fullPath)}" tabindex="0" role="button" aria-label="Copy path" title="Copy path to clipboard"></span>
      <span class="ds-copy" tabindex="0" role="button" aria-label="Copy value" title="Copy value to clipboard"></span>
      ${exploreSpan}
    </td>
  `;

  // Optimized event handling with utility functions
  setupRowEventHandlers(row, r, fullPath, isObj);
  
  return row;
}

// Extracted event handler setup for better organization
function setupRowEventHandlers(row, resultData, fullPath, isObj) {
  // Copy path functionality
  const pathCopyBtn = row.querySelector('.ds-pathcopy');
  if (pathCopyBtn) {
    EventManager.add(pathCopyBtn, 'click', () => Utils.copyToClipboard(fullPath));
  }

  // Copy value functionality
  const copyBtn = row.querySelector('.ds-copy');
  if (copyBtn) {
    EventManager.add(copyBtn, 'click', () => {
      let value = resultData.originalValue || resultData.value;
      
      // If it's a serialized object, try to format it nicely
      if (typeof value === 'string' && (value.startsWith('{') || value.startsWith('['))) {
        try {
          const parsed = JSON.parse(value);
          value = JSON.stringify(parsed, null, 2);
        } catch (e) {
          // Keep original if parsing fails
        }
      }
      
      Utils.copyToClipboard(String(value));
    });
  }

  // Expand functionality for objects
  if (isObj) {
    const expandBtn = row.querySelector('.ds-expand');
    if (expandBtn) {
      const expandHandler = () => toggleExpand(row, fullPath, resultData);
      EventManager.add(expandBtn, 'click', expandHandler);
      EventManager.add(expandBtn, 'keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          expandHandler();
        }
      });
    }
    
    // Explore functionality for objects
    const exploreBtn = row.querySelector('.ds-explore');
    if (exploreBtn) {
      const exploreHandler = () => exploreObject(fullPath);
      EventManager.add(exploreBtn, 'click', exploreHandler);
      EventManager.add(exploreBtn, 'keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          exploreHandler();
        }
      });
    }
  }
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
    $('ds-status').textContent = 'Expanding object...';
    
    // Check if we're in a valid Chrome extension context
    if (!Utils.isExtensionContextValid()) {
      $('ds-status').textContent = 'Extension context invalidated. Please reload the DevTools.';
      return;
    }
    
    // Send message to get object properties
    Utils.safeExecute(() => {
      if (!port) connect();
      
      // Ensure we still have a valid connection after connect attempt
      if (!port) {
        $('ds-status').textContent = 'Failed to establish connection. Please reload the DevTools.';
        return;
      }
      
      port.postMessage({
        tabId: chrome.devtools.inspectedWindow.tabId,
        action: 'getObjectProperties',
        path: objectPath
      });
    }, 'Error requesting object properties');
  }
}

function exploreObject(objectPath) {
  if (!objectPath) {
    console.warn('exploreObject called with empty objectPath');
    return;
  }
  
  console.log('exploreObject called with path:', objectPath);
  
  // Stop any active search before starting exploration
  if ($('ds-stop').style.display !== 'none') {
    console.log('Stopping active search before exploration');
    handleStopSearch();
  }
  
  Utils.safeExecute(() => {
    // Set the search scope to this object path
    const searchScopeInput = $('search-scope');
    const clearScopeBtn = $('clear-scope');
    const searchScopeContainer = document.querySelector('.search-scope');
    
    console.log('Found elements:', {
      searchScopeInput: !!searchScopeInput,
      clearScopeBtn: !!clearScopeBtn,
      searchScopeContainer: !!searchScopeContainer
    });
    
    if (searchScopeInput) {
      searchScopeInput.value = objectPath;
      window.searchScope = objectPath; // Store for use in searches
      console.log('Set search scope to:', objectPath);
    } else {
      console.error('search-scope input element not found');
    }
    
    // Show the search scope container and clear button
    if (searchScopeContainer) {
      searchScopeContainer.style.display = 'block';
      console.log('Showed search scope container');
    } else {
      console.error('search-scope container not found');
    }
    
    if (clearScopeBtn) {
      clearScopeBtn.style.display = 'inline-block';
      clearScopeBtn.textContent = `Clear scope: ${objectPath.length > 30 ? objectPath.substring(0, 30) + '...' : objectPath}`;
      
      // Remove existing click listeners and add new one
      const newClearBtn = clearScopeBtn.cloneNode(true);
      
      // Check if parentNode exists before calling replaceChild
      if (clearScopeBtn.parentNode) {
        clearScopeBtn.parentNode.replaceChild(newClearBtn, clearScopeBtn);
        
        EventManager.add(newClearBtn, 'click', () => {
          if (searchScopeInput) searchScopeInput.value = '';
          if (searchScopeContainer) searchScopeContainer.style.display = 'none';
          newClearBtn.style.display = 'none';
          window.searchScope = null; // Clear stored scope
          $('ds-status').textContent = 'Search scope cleared';
          
          // Automatically trigger a search from the root
          if ($('ds-term').value) {
            // Create a synthetic event to pass to handleFormSubmit
            const syntheticEvent = { preventDefault: () => {} };
            handleFormSubmit(syntheticEvent);
          }
        });
        console.log('Replaced clear button with new one');
      } else {
        // If parentNode is null, just remove existing listeners and add new one
        EventManager.removeForElement(clearScopeBtn);
        EventManager.add(clearScopeBtn, 'click', () => {
          if (searchScopeInput) searchScopeInput.value = '';
          if (searchScopeContainer) searchScopeContainer.style.display = 'none';
          clearScopeBtn.style.display = 'none';
          window.searchScope = null; // Clear stored scope
          $('ds-status').textContent = 'Search scope cleared';
          
          // Automatically trigger a search from the root
          if ($('ds-term').value) {
            // Create a synthetic event to pass to handleFormSubmit
            const syntheticEvent = { preventDefault: () => {} };
            handleFormSubmit(syntheticEvent);
          }
        });
        console.log('Updated existing clear button');
      }
    } else {
      console.error('clear-scope button not found');
    }
    
    // Update status to show scope was set
    $('ds-status').textContent = `Search scope set to: ${objectPath}`;
    
    // Automatically trigger a search with the new scope
    if ($('ds-term').value) {
      // Create a synthetic event to pass to handleFormSubmit
      const syntheticEvent = { preventDefault: () => {} };
      handleFormSubmit(syntheticEvent);
    }
    
    // Send message to get object properties
    if (Utils.isExtensionContextValid()) {
      if (!port) connect();
      
      // Ensure we still have a valid connection after connect attempt
      if (!port) {
        $('ds-status').textContent = 'Failed to establish connection. Please reload the DevTools.';
        return;
      }
      
      try {
        port.postMessage({
          tabId: chrome.devtools.inspectedWindow.tabId,
          action: 'getObjectProperties',
          path: objectPath
        });
      } catch (error) {
        console.warn('Failed to send object properties message:', error.message);
        $('ds-status').textContent = 'Extension context invalidated. Please reload the DevTools.';
      }
    } else {
      console.log('Extension context not valid - preview mode');
      $('ds-status').textContent = `Preview mode: Search scope set to ${objectPath}`;
    }
  }, 'Error exploring object');
}

// Utility function for file downloads
function downloadFile(content, fileName, contentType) {
  const a = document.createElement('a');
  const file = new Blob([content], {type: contentType});
  a.href = URL.createObjectURL(file);
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(a.href);
}

function handleObjectProperties(path, properties, success, warning) {
  // Update status based on success
  if (!success) {
    $('ds-status').textContent = 'Failed to get object properties.';
    // Find the row that was expanded and remove the expanded class
    const expandedRow = document.querySelector(`tr[data-expanded-path="${path}"]`);
    if (expandedRow) {
      const expandBtn = expandedRow.querySelector('.ds-expand');
      if (expandBtn) expandBtn.classList.remove('expanded');
      expandedRow.removeAttribute('data-expanded-path');
    }
    return;
  }

  // Find the row that was expanded
  const expandedRow = document.querySelector(`tr[data-expanded-path="${path}"]`);
  if (!expandedRow) {
    $('ds-status').textContent = 'Could not find expanded row.';
    return;
  }

  // Remove any existing expanded content
  if (expandedRow.expandedSubRow) {
    expandedRow.expandedSubRow.remove();
    delete expandedRow.expandedSubRow;
  }

  // Create expanded content row
  const subRow = document.createElement('tr');
  subRow.classList.add('ds-expanded-row');
  
  const subCell = document.createElement('td');
  subCell.colSpan = 5;
  subCell.style.padding = '0';
  
  // Handle warning message if present
  if (warning) {
    const warningDiv = document.createElement('div');
    warningDiv.className = 'ds-warning';
    Object.assign(warningDiv.style, {
      padding: '5px',
      backgroundColor: '#fff3cd',
      color: '#856404',
      borderRadius: '4px',
      margin: '5px'
    });
    warningDiv.textContent = `Warning: ${warning}`;
    subCell.appendChild(warningDiv);
  }
  
  // Handle empty properties array
  if (!properties || properties.length === 0) {
    const emptyDiv = document.createElement('div');
    Object.assign(emptyDiv.style, {
      padding: '10px',
      fontStyle: 'italic'
    });
    emptyDiv.textContent = 'No properties found or accessible.';
    subCell.appendChild(emptyDiv);
    subRow.appendChild(subCell);
    expandedRow.parentNode.insertBefore(subRow, expandedRow.nextSibling);
    expandedRow.expandedSubRow = subRow;
    $('ds-status').textContent = 'Object expanded, but no properties were found.';
    return;
  }
  
  const subTable = document.createElement('table');
  Object.assign(subTable.style, {
    width: '100%',
    marginLeft: '20px',
    backgroundColor: '#f8f9fa'
  });
  
  const subTbody = document.createElement('tbody');
  let successfulProps = 0;
  
  properties.forEach(prop => {
    Utils.safeExecute(() => {
      if (!prop || typeof prop !== 'object') return; // Skip invalid properties
      
      const propRow = createPropertyRow(prop);
      if (propRow) {
        subTbody.appendChild(propRow);
        successfulProps++;
      }
    }, 'Error processing property');
  });
  
  subTable.appendChild(subTbody);
  subCell.appendChild(subTable);
  subRow.appendChild(subCell);
  
  // Insert the expanded row after the main row
  expandedRow.parentNode.insertBefore(subRow, expandedRow.nextSibling);
  expandedRow.expandedSubRow = subRow;
  
  $('ds-status').textContent = `Expanded object with ${successfulProps} properties.`;
}

// Extracted property row creation for better organization
function createPropertyRow(prop) {
  const propRow = document.createElement('tr');
  const isObj = prop.type === 'object' && prop.value !== null && prop.value !== 'null';
  
  // Safely get preview text
  let previewText;
  try {
    previewText = Utils.escapeHTML(String(prop.value || ''));
  } catch (e) {
    previewText = '[Error displaying value]';
  }
  
  if (isObj && (previewText.startsWith('[object ') || previewText.startsWith('{'))) {
    previewText = '[Object]';
  }
  if (prop.type === 'function') previewText = '[Function]';
  
  const expandSpan = isObj ? '<span class="ds-expand" tabindex="0" role="button" aria-label="Expand object" title="Expand or collapse this object"></span>' : '';
  
  // Safely create HTML content
  try {
    propRow.innerHTML = `
      <td>↳</td>
      <td class="path-cell">${expandSpan}${Utils.escapeHTML(prop.key || '')}</td>
      <td>${prop.type || 'unknown'}</td>
      <td class="preview-cell"><span title="${previewText}">${previewText.slice(0, 60)}</span></td>
      <td>
        <span class="ds-pathcopy" data-path="${Utils.escapeHTML(prop.path || '')}" tabindex="0" role="button" aria-label="Copy path" title="Copy path to clipboard"></span>
        <span class="ds-copy" data-value="${Utils.escapeHTML(prop.originalValue || prop.value || '')}" tabindex="0" role="button" aria-label="Copy value" title="Copy value to clipboard"></span>
      </td>
    `;
  } catch (e) {
    console.error('Error creating property row HTML:', e);
    return null; // Skip this property
  }
  
  // Add event listeners with error handling
  setupPropertyRowEventHandlers(propRow, prop, isObj);
  
  return propRow;
}

// Extracted property row event handler setup
function setupPropertyRowEventHandlers(propRow, prop, isObj) {
  const pathCopyBtn = propRow.querySelector('.ds-pathcopy');
  if (pathCopyBtn) {
    EventManager.add(pathCopyBtn, 'click', (e) => {
      const path = e.target.getAttribute('data-path');
      if (path) Utils.copyToClipboard(path);
    });
  }
  
  const copyBtn = propRow.querySelector('.ds-copy');
  if (copyBtn) {
    EventManager.add(copyBtn, 'click', (e) => {
      const value = e.target.getAttribute('data-value');
      if (value) Utils.copyToClipboard(value);
    });
  }
  
  if (isObj) {
    const expandBtn = propRow.querySelector('.ds-expand');
    if (expandBtn) {
      const expandHandler = () => {
        Utils.safeExecute(() => {
          toggleExpand(propRow, prop.path, {type: prop.type, value: prop.value});
        }, 'Error expanding object');
      };
      
      EventManager.add(expandBtn, 'click', expandHandler);
      EventManager.add(expandBtn, 'keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          expandHandler();
        }
      });
    }
  }
}