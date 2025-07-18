const root = document.getElementById('root');

root.innerHTML = `
  <div id="deepSearchUI">
    <header>
      <span>Deep Search Tool</span>
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
    <div class="loader" style="display: none;"></div>
    <div id="ds-status" style="text-align: center; margin: 10px auto; font-style: italic; color: #666;white-space:nowrap;max-width:95%;overflow:hidden;"></div>
    <div id="deepSearchResults" aria-live="polite" aria-relevant="additions"></div>
  </div>
`;

const $ = id => document.getElementById(id);

let port;
let connectionEstablished = false;

function connect() {
  if (connectionEstablished) return;
  
  port = chrome.runtime.connect({ name: 'devtools-page' });
  port.postMessage({ 
    name: 'init', 
    tabId: chrome.devtools.inspectedWindow.tabId 
  });

  port.onMessage.addListener(function (msg) {
    if (msg.action === 'search_results') {
      renderResults(msg.results, msg.isDone);
    } else if (msg.action === 'status') {
      $('ds-status').textContent = msg.data;
    }
  });

  port.onDisconnect.addListener(() => {
    port = null;
    connectionEstablished = false;
  });
  
  connectionEstablished = true;
}

// Expose function for devtools.js to call
window.establishConnection = function() {
  connect();
};

$('deepSearchUI').querySelector('form').addEventListener('submit', (e) => {
  e.preventDefault();
  if (!port) connect();
  const term = $('ds-term').value;
  const options = {
    mode: $('ds-mode').value,
    matchType: $('ds-match').value,
    maxDepth: parseInt($('ds-depth').value, 10),
  };
  
  $('deepSearchResults').innerHTML = '';
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

let currentResults = [];

function renderResults(results, isDone) {
  currentResults = results;
  const resultsBox = $('deepSearchResults');
  
  if (isDone) {
    $('ds-stop').style.display = 'none';
    $('ds-status').textContent = `Search finished. Found ${results.length} results.`;
    if (results.length === 0) {
        resultsBox.innerHTML = '<p>No results found.</p>';
    }
    $('ds-export-json').disabled = results.length === 0;
    $('ds-export-csv').disabled = results.length === 0;
  } else {
    $('ds-status').textContent = `Found ${results.length} results so far...`;
  }

  let html = '<table><thead><tr><th>Path</th><th>Type</th><th>Preview</th></tr></thead><tbody>';
  results.forEach(r => {
    const preview = r.value ? escapeHTML(String(r.value)).slice(0, 200) : '';
    html += `<tr><td>${r.path}</td><td>${r.type}</td><td title="${escapeHTML(String(r.value))}">${preview}</td></tr>`;
  });
  html += '</tbody></table>';
  resultsBox.innerHTML = html;
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