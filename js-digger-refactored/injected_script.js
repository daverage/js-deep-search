(() => {
  console.log('Injected script loaded');

  // Listen for messages from the content script
  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data.type || event.data.type !== 'FROM_CONTENT') {
      return;
    }

    console.log('Injected script received:', event.data);

    if (event.data.action === 'search') {
      const onPartialUpdate = (results, isDone) => {
        window.postMessage({ 
          type: 'FROM_INJECTED', 
          action: 'search_results', 
          results: results, 
          isDone: isDone 
        }, '*');
      };

      deepSearch(window, event.data.term, { ...event.data.options, onPartialUpdate });
    } else if (event.data.action === 'cancel_search') {
      cancelSearch = true;
    }
  });

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
  async function deepSearch(obj, searchTerm, { onPartialUpdate, charLimit = 100000000, maxDepth = 100, blacklist = ['constructor', 'prototype', '__proto__'], maxResults = 1000, mode = 'both', matchType = 'partial' } = {}) {
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
                // Post status update
                window.postMessage({ type: 'FROM_INJECTED', action: 'status', data: `Scanning: ${peekItem.path} (Depth: ${peekItem.depth}, Queue: ${queue.length})` }, '*');

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
                        // We can't send the value directly if it's not serializable (e.g. functions, complex objects)
                        // So we send a serializable representation
                        results.push({ path: newPath, type: typeof value, value: safeStringify(value) });
                        totalChars += currentChars;
                    }

                    if ((typeof value === 'object' || typeof value === 'function') && value !== null) {
                        queue.push({ current: value, path: newPath, depth: depth + 1 });
                    }
                }
            }
            if (cancelSearch) {
                window.postMessage({ type: 'FROM_INJECTED', action: 'status', data: 'Search cancelled.' }, '*');
                onPartialUpdate(results, true); // Final update on cancel
                resolve();
                return;
              }
              onPartialUpdate(results, false); // Update after each batch
              if (queue.length > 0) {
                setTimeout(processBatch, 0);
              } else {
                window.postMessage({ type: 'FROM_INJECTED', action: 'status', data: 'Finalizing results...' }, '*');
                onPartialUpdate(results, true); // Final update
                resolve();
              }
        }
        processBatch();
    });

    return results;
  }
})();