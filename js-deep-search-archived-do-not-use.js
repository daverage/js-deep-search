// Deep Search Tool with Shadow DOM, Expandable Previews, Export, Copy Path, Type Info, Smart Scope Input & Dynamic Type Filter + Safe Stringify
(function () {
  if (document.getElementById('deepSearchHost')) return;

  const host = document.createElement('div');
  host.id = 'deepSearchHost';
  document.body.appendChild(host);

  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = `
    #deepSearchUI {
      position: fixed;
      top: 20px;
      right: 20px;
      width: 75%;
      max-width: 1200px;
      background: white;
      border: 1px solid #ccc;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.2);
      font-family: sans-serif;
      z-index: 2147483647;
    }
    header {
      background: #333;
      color: white;
      padding: 12px 18px;
      font-size: 16px;
      display: flex;
      justify-content: space-between;
      border-radius: 8px 8px 0 0;
    }
    form {
      padding: 16px 20px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .dropdown-row {
      display: flex;
      gap: 12px;
    }
    .dropdown-row select {
      flex: 1;
    }
    .button-row {
      display: flex;
      gap: 12px;
    }
    .button-row button {
      flex: 1;
    }
    select, input {
      padding: 8px;
      font-size: 14px;
    }
    datalist option {
      font-size: 13px;
    }
    button {
      padding: 10px;
      font-size: 14px;
      background: #007bff;
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
    }
    button:hover {
      background: #0056b3;
    }
    button.export {
      background: #28a745;
    }
    button.export:hover {
      background: #218838;
    }
    button:disabled {
      background: #ccc;
      cursor: not-allowed;
    }
    .loader {
      border: 4px solid #f3f3f3;
      border-top: 4px solid #3498db;
      border-radius: 50%;
      width: 24px;
      height: 24px;
      animation: spin 1s linear infinite;
      display: none; /* Hidden by default */
      margin: 0 auto;
    }
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
    #deepSearchResults {
      max-height: 400px;
      overflow-y: auto;
      border-top: 1px solid #eee;
      padding: 0 20px 20px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    th, td {
      padding: 10px;
      border-bottom: 1px solid #ddd;
      text-align: left;
      whitespace:nowrap;
    }
    th {
      background: #f9f9f9;
      position: sticky;
      top: 0;
      z-index: 1;
    }
    th:nth-child(1), td:nth-child(1) { width: 5%; }
    th:nth-child(2), td:nth-child(2) { width: 50%; }
    th:nth-child(3), td:nth-child(3) { width: 10%; }
    th:nth-child(4), td:nth-child(4) { width: 20%; }
    th:nth-child(5), td:nth-child(5) { width: 15%; }
    td.path-cell {
      max-width: none;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      direction: rtl;
      text-align: left;
    }
    td.preview-cell {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    #ds-close:hover{
      cursor:pointer;
    }
    .ds-copy, .ds-expand, .ds-pathcopy, .ds-explore {
      color: #007bff;
      cursor: pointer;
      text-decoration: none;
      margin-right: 8px;
      padding: 2px 6px;
      border-radius: 4px;
      transition: background-color 0.2s, color 0.2s;
    }
    .ds-copy:hover, .ds-expand:hover, .ds-pathcopy:hover, .ds-explore:hover {
      background-color: #e7f3ff;
      color: #0056b3;
    }
    .ds-expand::before {
      content: '\\25B6'; /* Right-pointing triangle for expand */
      margin-right: 4px;
    }
    .ds-expand.expanded::before {
      content: '\\25BC'; /* Down-pointing triangle for collapse */
      margin-right: 4px;
    }
    .ds-copy::before {
      content: '\\1F4CB'; /* Clipboard icon */
      margin-right: 4px;
    }
    .ds-pathcopy::before {
      content: '\\1F517'; /* Link icon */
      margin-right: 4px;
    }
    .ds-explore::before {
      content: '\\1F50D'; /* Magnifying glass icon */
      margin-right: 4px;
    }
  `;
  shadow.appendChild(style);

  const wrapper = document.createElement('div');
  wrapper.innerHTML = `
    <div id="deepSearchUI">
      <header>
        <span>Deep Search Tool</span>
        <span id="ds-close" role="button" tabindex="0" aria-label="Close search tool">✖</span>
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
          <select id="ds-type-filter" aria-label="Filter by result type" style="display:none;">
            <option value="all" selected>All Types</option>
          </select>
        </div>
        <div class="button-row">
          <button type="submit">Search</button>
          <button type="button" id="ds-stop" style="background: #dc3545; display: none;">Stop Search</button>
          <button type="button" id="ds-export-json" class="export" disabled>Export JSON</button>
          <button type="button" id="ds-export-csv" class="export" disabled>Export CSV</button>
        </div>
      </form>
      <div class="loader"></div>
      <div id="ds-status" style="text-align: center; margin: 10px auto; font-style: italic; color: #666;white-space:nowrap;max-width:95%;overflow:hidden;"></div>
      <div id="deepSearchResults" aria-live="polite" aria-relevant="additions"></div>
    </div>
  `;
  shadow.appendChild(wrapper);

  const $ = id => shadow.getElementById(id);
  const escapeHTML = str => str?.toString().replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;', '"':'&quot;'}[c])) ?? '';



  // Safe stringify to avoid circular errors
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

  function hasNonVarChars(name) {
    if (typeof name !== 'string') return true;
    for (var i = 0; i < name.length; i++) {
        if (/[A-Za-z0-9_$]/.test(name[i]) === false) {
            return true;
        }
    }
    return false; 
  }

  let cancelSearch = false;
async function deepSearch(obj, searchTerm, onPartialUpdate, { charLimit = 100000000, maxDepth = 100, blacklist = ['constructor', 'prototype', '__proto__', '__ds_results'], maxResults = 1000, mode = 'both', matchType = 'partial' } = {}) {
    const results = [];
    const visited = new Set();
    let totalChars = 0;
    const isMatch = t => typeof t === 'string' && (matchType === 'full' ? t.toLowerCase() === searchTerm.toLowerCase() : t.toLowerCase().includes(searchTerm.toLowerCase()));

    function stringValue(val) {
        let returnVal = "";
        try {
            if (val === null) return 'null';
            if (typeof val === 'string') return val;
            if (typeof val === 'function') {
                return val.toString();
            }
            if (typeof val === 'object') {
                 returnVal = Object.prototype.toString.call(val);
                 if(returnVal === '[object Object]'){
                    try{
                        return JSON.stringify(val);
                    } catch(e){
                        // Can't stringify, so just return the type
                    }
                 }
                 return returnVal;
            }
            return String(val);
        } catch (err) {
            try {
                return Object.prototype.toString.call(val);
            } catch(e) {
                return '[unintelligible]';
            }
        }
    }

    const queue = [{ current: obj, path: 'window', depth: 0 }];

    await new Promise(resolve => {
        function processBatch() {
            const batchSize = 50;
            for (let i = 0; i < batchSize && queue.length > 0; i++) {
                const peekItem = queue[0]; // Peek at first item
                $('ds-status').textContent = `Scanning: ${peekItem.path} (Depth: ${peekItem.depth}, Queue: ${queue.length})`;

                const { current, path, depth } = queue.shift();
                if (depth > maxDepth || totalChars >= charLimit || results.length >= maxResults) continue;

                if (current === null || (typeof current !== 'object' && typeof current !== 'function')) continue;

                if (visited.has(current)) continue;
                visited.add(current);

                let keys;
                try {
                    keys = Object.getOwnPropertyNames(current);
                } catch (e) {
                    continue;
                }

                for (const key of keys) {
                    if (blacklist.includes(key)) continue;

                    const keyStr = String(key);
                    let newPath;
                    if (hasNonVarChars(keyStr)) {
                        newPath = `${path}[${JSON.stringify(keyStr)}]`;
                    } else if (!isNaN(keyStr) && keyStr.trim() !== '') {
                        newPath = `${path}[${keyStr}]`;
                    } else {
                        newPath = path ? `${path}.${keyStr}` : keyStr;
                    }
                    let value;
                    try {
                        value = current[key];
                    } catch (e) {
                        continue;
                    }

                    const valueStr = stringValue(value);
                    const currentChars = newPath.length + valueStr.length;
                    const keyMatches = isMatch(key);
                    const valMatches = isMatch(valueStr);
                    const match = (mode === 'both' && (keyMatches || valMatches)) || (mode === 'key' && keyMatches) || (mode === 'value' && valMatches);

                    if (totalChars + currentChars > charLimit) continue;

                    if (match) {
                        results.push({ path: newPath, value: value, type: typeof value });
                        totalChars += currentChars;
                    }

                    if ((typeof value === 'object' || typeof value === 'function') && value !== null) {
                        queue.push({ current: value, path: newPath, depth: depth + 1 });
                    }
                }
            }
            if (cancelSearch) {
                $('ds-status').textContent = 'Search cancelled.';
                onPartialUpdate(results, true); // Final update on cancel
                resolve();
                return;
              }
              onPartialUpdate(results, false); // Update after each batch
              if (queue.length > 0) {
                setTimeout(processBatch, 0);
              } else {
                $('ds-status').textContent = 'Finalizing results...';
                onPartialUpdate(results, true); // Final update
                resolve();
              }
        }
        processBatch();
    });

    return results;
  }

  let currentResults = [];
  let filteredResults = [];

  function populateTypeFilter(types) {
    const typeFilter = $('ds-type-filter');
    typeFilter.innerHTML = '<option value="all" selected>All Types</option>';
    types.forEach(t => {
      const option = document.createElement('option');
      option.value = t;
      option.textContent = t[0].toUpperCase() + t.slice(1);
      typeFilter.appendChild(option);
    });
    typeFilter.style.display = types.length > 0 ? 'block' : 'none';
  }

  let lastRenderedIndex = 0;
  let resultsTable = null;

  function initializeResultsTable() {
    const resultsBox = $('deepSearchResults');
    resultsBox.innerHTML = '';
    resultsTable = document.createElement('table');
    resultsTable.innerHTML = `<thead><tr><th>#</th><th>Path</th><th>Type</th><th>Preview</th><th>Actions</th></tr></thead><tbody></tbody>`;
    resultsBox.appendChild(resultsTable);
    lastRenderedIndex = 0;
  }

  function appendResults(newResults, basePath = 'window', isFinal = false) {
    if (!resultsTable) return;
    const tbody = resultsTable.querySelector('tbody');
    newResults.slice(lastRenderedIndex).forEach((r, i) => {
      const globalIndex = lastRenderedIndex + i;
      const row = createResultRow(r, globalIndex, newResults, basePath);
      tbody.appendChild(row);
    });
    lastRenderedIndex = newResults.length;
    if (isFinal) {
      if (newResults.length === 0) {
        $('deepSearchResults').innerHTML = '<p>No results found.</p>';
      }
      $('ds-export-json').disabled = newResults.length === 0;
      $('ds-export-csv').disabled = newResults.length === 0;
    }
  }

  function renderResults(results, basePath = 'window') {
    const resultsBox = $('deepSearchResults');
    resultsBox.innerHTML = '';
    if (!results.length) {
      resultsBox.innerHTML = '<p>No results found.</p>';
      $('ds-export-json').disabled = true;
      $('ds-export-csv').disabled = true;
      return;
    }
    $('ds-export-json').disabled = false;
    $('ds-export-csv').disabled = false;
    const table = document.createElement('table');
    table.innerHTML = `<thead><tr><th>#</th><th>Path</th><th>Type</th><th>Preview</th><th>Actions</th></tr></thead>`;
    const tbody = document.createElement('tbody');
    results.forEach((r, i) => {
      const row = createResultRow(r, i, results, basePath);
      tbody.appendChild(row);
    });
    table.appendChild(tbody);
    resultsBox.appendChild(table);
  }

  function createResultRow(r, i, results, basePath) {
    const row = document.createElement('tr');
    const val = r.value;
    const fullPath = r.path;
    const displayPath = fullPath.replace(/^window\./, '');
    const isObj = typeof val === 'object' && val !== null;
    const previewText = isObj ? '[Object]' : escapeHTML(String(val));
    const expandSpan = isObj ? '<span class="ds-expand" tabindex="0" role="button" aria-label="Expand object" title="Expand or collapse this object"></span>' : '';
    row.innerHTML = `
      <td>${i + 1}</td>
      <td class="path-cell" title="${escapeHTML(displayPath)}">${expandSpan}${escapeHTML(displayPath)}</td>
      <td>${r.type}</td>
      <td class="preview-cell"><span title="${previewText}">${previewText.slice(0, 60)}</span></td>
      <td>
        <span class="ds-pathcopy" data-path="${escapeHTML(fullPath)}" tabindex="0" role="button" aria-label="Copy path" title="Copy path to clipboard"></span>
        <span class="ds-copy" data-idx="${i}" tabindex="0" role="button" aria-label="Copy value" title="Copy value to clipboard"></span>
        ${isObj ? '<span class="ds-explore" data-idx="${i}" tabindex="0" role="button" aria-label="Explore this object" title="Set as search scope and explore"></span>' : ''}
      </td>
    `;

    attachCopyListeners(row, results, i, fullPath);

    if (isObj) {
      const expand = row.querySelector('.ds-expand');
      expand.addEventListener('click', () => toggleExpand(row, val, fullPath));
      expand.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggleExpand(row, val, fullPath);
        }
      });

      const explore = row.querySelector('.ds-explore');
      explore.addEventListener('click', () => exploreObject(val, fullPath));
      explore.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          exploreObject(val, fullPath);
        }
      });
    }
    return row;
  }

  function attachCopyListeners(row, results, i, fullPath) {
    row.querySelector('.ds-copy').addEventListener('click', () => {
      const val = results[i].value;
      navigator.clipboard.writeText(typeof val === 'string' ? val : safeStringify(val));
    });
    row.querySelector('.ds-copy').addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const val = results[i].value;
        navigator.clipboard.writeText(typeof val === 'string' ? val : safeStringify(val));
      }
    });
    row.querySelector('.ds-pathcopy').addEventListener('click', () => {
      navigator.clipboard.writeText(fullPath);
    });
    row.querySelector('.ds-pathcopy').addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        navigator.clipboard.writeText(fullPath);
      }
    });
  }

  function toggleExpand(row, obj, basePath) {
    let expandSpan = row.querySelector('.ds-expand');
    if (expandSpan.classList.contains('expanded')) {
      expandSpan.classList.remove('expanded');
      if (row.expandedSubRow) {
        row.expandedSubRow.remove();
        delete row.expandedSubRow;
      }
    } else {
      expandSpan.classList.add('expanded');
      const subRow = document.createElement('tr');
      const subTd = document.createElement('td');
      subTd.colSpan = 5;
      subTd.style.paddingLeft = '20px';
      subTd.style.backgroundColor = '#f9f9f9';
      subTd.style.borderLeft = '2px solid #007bff';
      const subTable = document.createElement('table');
      subTable.style.width = '100%';
      const subTbody = document.createElement('tbody');
      let subIndex = 1;
      for (let key in obj) {
        if (obj.hasOwnProperty(key)) {
          const val = obj[key];
          const subPath = `${basePath}.${key}`;
          const subR = { path: subPath, value: val, type: typeof val };
          const subResultRow = createResultRow(subR, (subIndex++)-1, [subR], basePath);
          subTbody.appendChild(subResultRow);
        }
      }
      subTable.appendChild(subTbody);
      subTd.appendChild(subTable);
      subRow.appendChild(subTd);
      row.parentNode.insertBefore(subRow, row.nextSibling);
      row.expandedSubRow = subRow;
    }
  }

  async function exploreObject(obj, basePath) {
    const loader = shadow.querySelector('.loader');
    loader.style.display = 'block';
    $('ds-status').textContent = 'Exploring object...';
    const term = $('ds-term').value.trim();
    const mode = $('ds-mode').value;
    const match = $('ds-match').value;
    const maxDepth = parseInt($('ds-depth').value, 10);
    try {
      const res = await deepSearch(obj, term, { mode, matchType: match, maxDepth });
      currentResults = res.map(r => ({ ...r, path: basePath + r.path.replace('window', '') }));
      filteredResults = currentResults;
      const uniqueTypes = Array.from(new Set(currentResults.map(r => r.type))).sort();
      populateTypeFilter(uniqueTypes);
      renderResults(currentResults, basePath);
    } catch (error) {
      $('deepSearchResults').innerHTML = `<p>Error during exploration: ${escapeHTML(error.message)}</p>`;
    } finally {
      loader.style.display = 'none';
      $('ds-stop').style.display = 'none';
      $('ds-status').textContent = '';
    }
  }

  $('ds-type-filter').addEventListener('change', () => {
    const filterVal = $('ds-type-filter').value;
    if (filterVal === 'all') {
      filteredResults = currentResults;
    } else {
      filteredResults = currentResults.filter(r => r.type === filterVal);
    }
    renderResults(filteredResults);
  });

  $('ds-close').onclick = () => host.remove();

  $('ds-export-json').onclick = () => {
    if (window.__ds_results) {
      const exportData = filteredResults.length ? filteredResults : currentResults;
      const blob = new Blob([safeStringify(exportData, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'deep_search_results.json';
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  $('ds-export-csv').onclick = () => {
    if (window.__ds_results) {
      const exportData = filteredResults.length ? filteredResults : currentResults;
      const rows = [['Index', 'Path', 'Type', 'Value']];
      exportData.forEach((r, i) => rows.push([i + 1, r.path, r.type, safeStringify(r.value)]));
      const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}""`).join(',')).join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'deep_search_results.csv';
      a.click();
      URL.revokeObjectURL(url);
    }
  };



  $('ds-stop').addEventListener('click', () => {
      cancelSearch = true;
      $('ds-stop').style.display = 'none';
    });

    $('deepSearchUI').querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const term = $('ds-term').value.trim();
    const scopeStr = 'window';
    const loader = shadow.querySelector('.loader');
    const resultsBox = $('deepSearchResults');

    if (!term) return;

    loader.style.display = 'block';
    $('ds-stop').style.display = 'block';
    cancelSearch = false;
    $('ds-status').textContent = 'Preparing search...';
    initializeResultsTable();

    try {
      const scope = window;
      const mode = $('ds-mode').value;
      const match = $('ds-match').value;
      const maxDepth = parseInt($('ds-depth').value, 10);
      
      currentResults = await deepSearch(scope, term, (partialResults, isFinal) => {
        filteredResults = partialResults;
        appendResults(partialResults, 'window', isFinal);
        if (isFinal) {
          const uniqueTypes = Array.from(new Set(partialResults.map(r => r.type))).sort();
          populateTypeFilter(uniqueTypes);
        }
      }, { mode: mode, matchType: match, maxDepth });
      window.__ds_results = currentResults;
    } catch (error) {
      resultsBox.innerHTML = `<p>Error during search: ${escapeHTML(error.message)}</p>`;
    } finally {
      loader.style.display = 'none';
      $('ds-stop').style.display = 'none';
      $('ds-status').textContent = '';
    }
  });
})();