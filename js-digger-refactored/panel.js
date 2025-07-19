const root = document.getElementById('root');

root.innerHTML = `
  <div id="deepSearchUI">
    <header>
      <span>JS Deep Search</span>
    </header>
    <form>
      <input type="text" placeholder="Enter search term..." id="ds-term" required aria-label="Search term" />
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
        <button type="button" id="ds-export-json" class="export" disabled>Export JSON</button>
        <button type="button" id="ds-export-csv" class="export" disabled>Export CSV</button>
      </div>
    </form>
    <div class="filter-row" id="filter-row" style="display: none;">
      <label for="ds-type-filter">Filter by type:</label>
      <select id="ds-type-filter" aria-label="Filter by type">
        <option value="">All types</option>
      </select>
      <span id="filter-count"></span>
    </div>
    <div class="loader" style="display: none;"></div>
    <div id="ds-status" style="text-align: center; margin: 10px auto; font-style: italic; color: #666;white-space:nowrap;max-width:95%;overflow:hidden;"></div>
    <div id="deepSearchResults" aria-live="polite" aria-relevant="additions"></div>
  </div>
`;

const $ = id => document.getElementById(id);

let port;
let connectionEstablished = false;
let currentResults = [];
let allResults = []; // Store all results for filtering
let instanceId = Date.now() + Math.random(); // Unique instance ID

function connect() {
  if (connectionEstablished) return;
  
  port = chrome.runtime.connect({ name: 'devtools-page' });
  port.postMessage({ 
    name: 'init', 
    tabId: chrome.devtools.inspectedWindow.tabId,
    instanceId: instanceId
  });

  port.onMessage.addListener(function (msg) {
    if (msg.action === 'search_results') {
        renderResults(msg.results, msg.isDone);
      } else if (msg.action === 'status') {
        $('ds-status').textContent = msg.data;
      } else if (msg.action === 'objectProperties') {
        handleObjectProperties(msg.path, msg.properties, msg.success);
      }
  });

  port.onDisconnect.addListener(() => {
    cleanup();
  });
  
  connectionEstablished = true;
}

function cleanup() {
  // Reset all state
  currentResults = [];
  allResults = [];
  connectionEstablished = false;
  port = null;
  
  // Clear UI
  $('deepSearchResults').innerHTML = '';
  $('ds-status').textContent = '';
  $('ds-stop').style.display = 'none';
  $('ds-export-json').disabled = true;
  $('ds-export-csv').disabled = true;
  $('filter-row').style.display = 'none';
  
  console.log('Panel cleaned up for instance:', instanceId);
}

// Cleanup when DevTools panel is closed
window.addEventListener('beforeunload', cleanup);

// Expose function for devtools.js to call
window.establishConnection = function() {
  connect();
};

$('deepSearchUI').querySelector('form').addEventListener('submit', (e) => {
  e.preventDefault();
  if (!port) connect();
  
  // Reset state for new search
  currentResults = [];
  allResults = [];
  $('deepSearchResults').innerHTML = '';
  $('ds-export-json').disabled = true;
  $('ds-export-csv').disabled = true;
  $('filter-row').style.display = 'none';
  
  const term = $('ds-term').value;
  const options = {
    mode: $('ds-mode').value,
    matchType: $('ds-match').value,
    maxDepth: parseInt($('ds-depth').value, 10),
    instanceId: instanceId
  };
  
  $('ds-status').textContent = 'Starting search...';
  $('ds-stop').style.display = 'block';
  
  port.postMessage({ 
    tabId: chrome.devtools.inspectedWindow.tabId,
    action: 'search',
    term: term,
    options: options
  });
});

$('ds-stop').addEventListener('click', () => {
  if (!port) connect();
  port.postMessage({ 
    tabId: chrome.devtools.inspectedWindow.tabId,
    action: 'cancel_search'
  });
  $('ds-status').textContent = 'Search cancelled.';
  $('ds-stop').style.display = 'none';
});

// Type filter event listener
$('ds-type-filter').addEventListener('change', () => {
  const selectedType = $('ds-type-filter').value;
  
  if (selectedType) {
    // Filter results by selected type
    currentResults = allResults.filter(r => r.type === selectedType);
  } else {
    // Show all results
    currentResults = allResults;
  }
  
  displayFilteredResults(currentResults);
  updateFilterCount();
});

function renderResults(results, isDone) {
  allResults = results; // Store all results for filtering
  currentResults = results; // Initially show all results
  
  if (isDone) {
    $('ds-stop').style.display = 'none';
    $('ds-status').textContent = `Search finished. Found ${results.length} results.`;
    if (results.length === 0) {
        $('deepSearchResults').innerHTML = '<p>No results found.</p>';
        $('filter-row').style.display = 'none';
        return;
    }
    $('ds-export-json').disabled = results.length === 0;
    $('ds-export-csv').disabled = results.length === 0;
    
    // Show and populate the type filter
    populateTypeFilter(results);
    $('filter-row').style.display = 'flex';
  } else {
    $('ds-status').textContent = `Found ${results.length} results so far...`;
  }

  displayFilteredResults(currentResults);
}

function populateTypeFilter(results) {
  const typeFilter = $('ds-type-filter');
  const types = new Set();
  const typeCounts = {};
  
  // Collect all unique types and their counts
  results.forEach(r => {
    types.add(r.type);
    typeCounts[r.type] = (typeCounts[r.type] || 0) + 1;
  });
  
  // Clear existing options except "All types"
  typeFilter.innerHTML = '<option value="">All types</option>';
  
  // Add type options sorted alphabetically with counts
  Array.from(types).sort().forEach(type => {
    const option = document.createElement('option');
    option.value = type;
    option.textContent = `${type} (${typeCounts[type]})`;
    typeFilter.appendChild(option);
  });
  
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
  
  results.forEach((r, i) => {
    const row = createResultRow(r, i, results);
    tbody.appendChild(row);
  });
  
  table.appendChild(tbody);
  resultsBox.innerHTML = '';
  resultsBox.appendChild(table);
}

function createResultRow(r, i, results) {
  const row = document.createElement('tr');
  
  // Use originalValue for display if available, otherwise fall back to value
  const displayValue = r.originalValue || r.value;
  const fullPath = r.path;
  const displayPath = fullPath.replace(/^window\./, '');
  const isObj = r.type === 'object' && displayValue !== null && displayValue !== 'null';
  let previewText = escapeHTML(String(displayValue));
  if (isObj && (previewText.startsWith('[object ') || previewText.startsWith('{'))) previewText = '[Object]';
  if (r.type === 'function') previewText = '[Function]';

  const expandSpan = isObj ? '<span class="ds-expand" tabindex="0" role="button" aria-label="Expand object" title="Expand or collapse this object"></span>' : '';
  row.innerHTML = `
    <td>${i + 1}</td>
    <td class="path-cell" title="${escapeHTML(displayPath)}">${expandSpan}${escapeHTML(displayPath)}</td>
    <td>${r.type}</td>
    <td class="preview-cell"><span title="${previewText}">${previewText.slice(0, 60)}</span></td>
    <td>
      <span class="ds-pathcopy" data-path="${escapeHTML(fullPath)}" tabindex="0" role="button" aria-label="Copy path" title="Copy path to clipboard"></span>
      <span class="ds-copy" tabindex="0" role="button" aria-label="Copy value" title="Copy value to clipboard"></span>
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
    let value = r.originalValue || r.value;
    
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
    expandBtn.addEventListener('click', () => toggleExpand(row, fullPath, r));
    expandBtn.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleExpand(row, fullPath, r);
      }
    });
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
    $('ds-status').textContent = 'Expanding object...';
    
    // Send message to get object properties
    if (!port) connect();
    port.postMessage({
      tabId: chrome.devtools.inspectedWindow.tabId,
      action: 'getObjectProperties',
      path: objectPath
    });
  }
}

function fallbackCopyText(text) {
  const textArea = document.createElement('textarea');
  textArea.value = text;
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();
  try {
    document.execCommand('copy');
  } catch (err) {
    console.error('Fallback copy failed:', err);
  }
  document.body.removeChild(textArea);
}

function escapeHTML(str) {
    return str.toString().replace(/[&<>'"]/g, 
      tag => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[tag] || tag)
    );
}

function download(content, fileName, contentType) {
  const a = document.createElement('a');
  const file = new Blob([content], {type: contentType});
  a.href = URL.createObjectURL(file);
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(a.href);
}

$('ds-export-json').addEventListener('click', () => {
  const json = JSON.stringify(currentResults, null, 2);
  download(json, 'js-digger-results.json', 'application/json');
});

$('ds-export-csv').addEventListener('click', () => {
  let csv = '"Path","Type","Value"\n';
  currentResults.forEach(r => {
    const path = `"${r.path.replace(/"/g, '""')}"`;
    const type = `"${r.type.replace(/"/g, '""')}"`;
    const value = `"${String(r.value).replace(/"/g, '""')}"`;
    csv += `${path},${type},${value}\n`;
  });
  download(csv, 'js-digger-results.csv', 'text/csv');
});

// Handle object properties response
function handleObjectProperties(path, properties, success) {
  if (!success) {
    $('ds-status').textContent = 'Failed to get object properties.';
    return;
  }

  // Find the row that was expanded
  const expandedRow = document.querySelector(`tr[data-expanded-path="${path}"]`);
  if (!expandedRow) return;

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
  
  const subTable = document.createElement('table');
  subTable.style.width = '100%';
  subTable.style.marginLeft = '20px';
  subTable.style.backgroundColor = '#f8f9fa';
  
  const subTbody = document.createElement('tbody');
  
  properties.forEach(prop => {
    const propRow = document.createElement('tr');
    const isObj = prop.type === 'object' && prop.value !== null && prop.value !== 'null';
    let previewText = escapeHTML(String(prop.value));
    if (isObj && (previewText.startsWith('[object ') || previewText.startsWith('{'))) previewText = '[Object]';
    if (prop.type === 'function') previewText = '[Function]';
    
    const expandSpan = isObj ? '<span class="ds-expand" tabindex="0" role="button" aria-label="Expand object" title="Expand or collapse this object"></span>' : '';
    propRow.innerHTML = `
      <td>↳</td>
      <td class="path-cell">${expandSpan}${escapeHTML(prop.key)}</td>
      <td>${prop.type}</td>
      <td class="preview-cell"><span title="${previewText}">${previewText.slice(0, 60)}</span></td>
      <td>
        <span class="ds-pathcopy" data-path="${escapeHTML(prop.path)}" tabindex="0" role="button" aria-label="Copy path" title="Copy path to clipboard"></span>
        <span class="ds-copy" data-value="${escapeHTML(prop.originalValue || prop.value)}" tabindex="0" role="button" aria-label="Copy value" title="Copy value to clipboard"></span>
      </td>
    `;
    
    // Add event listeners
    propRow.querySelector('.ds-pathcopy').addEventListener('click', (e) => {
      const path = e.target.getAttribute('data-path');
      try {
        navigator.clipboard.writeText(path).catch(() => {
          fallbackCopyText(path);
        });
      } catch (e) {
        fallbackCopyText(path);
      }
    });
    
    propRow.querySelector('.ds-copy').addEventListener('click', (e) => {
      const value = e.target.getAttribute('data-value');
      try {
        navigator.clipboard.writeText(value).catch(() => {
          fallbackCopyText(value);
        });
      } catch (e) {
        fallbackCopyText(value);
      }
    });
    
    if (isObj) {
      const expandBtn = propRow.querySelector('.ds-expand');
      if (expandBtn) {
        expandBtn.addEventListener('click', () => toggleExpand(propRow, prop.path, {type: prop.type, value: prop.value}));
        expandBtn.addEventListener('keydown', e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggleExpand(propRow, prop.path, {type: prop.type, value: prop.value});
          }
        });
      }
    }
    
    subTbody.appendChild(propRow);
  });
  
  subTable.appendChild(subTbody);
  subCell.appendChild(subTable);
  subRow.appendChild(subCell);
  
  // Insert the expanded row after the main row
  expandedRow.parentNode.insertBefore(subRow, expandedRow.nextSibling);
  expandedRow.expandedSubRow = subRow;
  
  $('ds-status').textContent = `Expanded object with ${properties.length} properties.`;
}