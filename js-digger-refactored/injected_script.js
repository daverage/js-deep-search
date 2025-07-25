(() => {
  console.log('Injected script loaded');

  let isCleanedUp = false;
  let searchTimeouts = new Set();
  let activeSearches = new Set();
  let cancelSearch = false;

  // Cleanup function
  function cleanup() {
    isCleanedUp = true;
    cancelSearch = true;
    
    // Clear all timeouts
    searchTimeouts.forEach(timeoutId => clearTimeout(timeoutId));
    searchTimeouts.clear();
    
    // Cancel active searches
    activeSearches.clear();
    
    console.log('Injected script cleaned up');
  }

  // Helper function to create managed timeouts
  function createManagedTimeout(callback, delay, searchId = null) {
    const timeoutId = setTimeout(() => {
      searchTimeouts.delete(timeoutId);
      if (!isCleanedUp && (!searchId || activeSearches.has(searchId))) {
        callback();
      }
    }, delay);
    
    searchTimeouts.add(timeoutId);
    return timeoutId;
  }

  // Helper function to clear managed timeout
  function clearManagedTimeout(timeoutId) {
    clearTimeout(timeoutId);
    searchTimeouts.delete(timeoutId);
  }

  // Listen for messages from the content script
  window.addEventListener('message', (event) => {
    if (isCleanedUp) return;
    
    if (event.source !== window || !event.data.type || event.data.type !== 'TO_INJECTED') {
      return;
    }

    console.log('Injected script received:', event.data);

    if (event.data.action === 'cleanup') {
      cleanup();
      return;
    }

    if (event.data.action === 'search') {
      // Reset cancelSearch flag when starting a new search
      cancelSearch = false;
      
      const searchId = Date.now() + Math.random();
      activeSearches.add(searchId);
      
      const onPartialUpdate = (results, isDone) => {
        if (isCleanedUp || !activeSearches.has(searchId)) return;
        
        window.postMessage({ 
          type: 'FROM_INJECTED', 
          action: 'search_results', 
          results: results, 
          isDone: isDone 
        }, '*');
        
        if (isDone) {
          activeSearches.delete(searchId);
        }
      };

      // Check if a search scope is provided
      if (event.data.options && event.data.options.scope) {
        // Use scoped search with the specified object as root
        const scopeObj = getObjectByPath(event.data.options.scope);
        if (scopeObj) {
          deepSearchWithCustomRoot(scopeObj, event.data.options.scope, event.data.term, { 
            ...event.data.options, 
            onPartialUpdate,
            searchId 
          });
        } else {
          // If scope object not found, fall back to window search
          deepSearch(window, event.data.term, { 
            ...event.data.options, 
            onPartialUpdate,
            searchId 
          });
        }
      } else {
        // No scope provided, search from window as usual
        deepSearch(window, event.data.term, { 
          ...event.data.options, 
          onPartialUpdate,
          searchId 
        });
      }
    } else if (event.data.action === 'cancel_search') {
      console.log('Cancelling search - clearing all timeouts and active searches');
      cancelSearch = true;
      
      // Immediately clear all timeouts
      searchTimeouts.forEach(timeoutId => clearTimeout(timeoutId));
      searchTimeouts.clear();
      
      // Clear active searches
      activeSearches.clear();
      
      // DON'T send empty results - this would clear the display
      // The panel will handle UI updates (stop button, status) on its own
      // Just silently stop the search and preserve existing results
    } else if (event.data.action === 'getObjectProperties') {
      if (!isCleanedUp) {
        getObjectProperties(event.data.path);
      }
    } else if (event.data.action === 'exploreObject') {
      if (!isCleanedUp) {
        // Reset cancelSearch flag when starting a new exploration
        cancelSearch = false;
        
        const searchId = Date.now() + Math.random();
        activeSearches.add(searchId);
        
        const onPartialUpdate = (results, isDone) => {
          if (isCleanedUp || !activeSearches.has(searchId)) return;
          
          window.postMessage({ 
            type: 'FROM_INJECTED', 
            action: 'search_results', 
            results: results, 
            isDone: isDone 
          }, '*');
          
          if (isDone) {
            activeSearches.delete(searchId);
          }
        };
        exploreObject(event.data.path, event.data.term, { 
          ...event.data.options, 
          onPartialUpdate,
          searchId 
        });
      }
    }
  });

  // Cleanup on page unload
  window.addEventListener('beforeunload', cleanup);

  // Safe stringify to avoid circular errors and handle non-cloneable objects
  function safeStringify(obj, space = 2) {
    const seen = new WeakSet();
    return JSON.stringify(obj, (key, value) => {
      if (typeof value === "object" && value !== null) {
        if (seen.has(value)) return "[Circular]";
        seen.add(value);
        
        // Handle non-cloneable objects
        if (value instanceof WebGLUniformLocation || 
            value instanceof WebGLBuffer || 
            value instanceof WebGLTexture ||
            value instanceof WebGLShader ||
            value instanceof WebGLProgram ||
            value instanceof WebGLFramebuffer ||
            value instanceof WebGLRenderbuffer ||
            value.constructor && value.constructor.name && value.constructor.name.startsWith('WebGL')) {
          return `[${value.constructor.name}]`;
        }
        
        // Handle other non-cloneable objects
        try {
          // Test if the object can be cloned by attempting a structured clone
          if (typeof structuredClone !== 'undefined') {
            structuredClone(value);
          } else {
            // Fallback for older browsers - try JSON serialization
            JSON.stringify(value);
          }
          return value;
        } catch (e) {
          // If it can't be cloned, return a safe representation
          try {
            return `[${value.constructor ? value.constructor.name : 'Object'}]`;
          } catch (constructorError) {
            // Handle objects with problematic constructors
            return '[Object with no primitive conversion]';
          }
        }
      }
      
      if (typeof value === "function") {
        return "[Function]";
      }
      
      try {
        return value;
      } catch (primitiveError) {
        // Handle values that can't be converted to primitives
        return '[Value with no primitive conversion]';
      }
    }, space);
  }

  // Safe value for postMessage - ensures the value can be cloned
  function safeValueForPostMessage(value) {
    try {
      // Test if the value can be cloned
      if (typeof structuredClone !== 'undefined') {
        structuredClone(value);
      } else {
        // Fallback for older browsers - try JSON serialization
        JSON.stringify(value);
      }
      return value;
    } catch (e) {
      // If it can't be cloned, return a safe string representation
      if (value && value.constructor) {
        return `[${value.constructor.name}]`;
      }
      try {
        return String(value);
      } catch (stringError) {
        // Handle objects that can't be converted to primitives
        return '[Object with no primitive conversion]';
      }
    }
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

  // Comprehensive blacklist for web developer-focused searching
  const DEFAULT_BLACKLIST = {
    // Basic object internals
    properties: [
      'constructor', 'prototype', '__proto__', '__defineGetter__', '__defineSetter__',
      '__lookupGetter__', '__lookupSetter__', 'hasOwnProperty', 'isPrototypeOf',
      'propertyIsEnumerable', 'toString', 'valueOf', 'toLocaleString'
    ],
    
    // Browser internals and Chrome-specific
    browserInternals: [
      // Chrome DevTools
      '__devtools', '__devtoolsFormatters', '__REACT_DEVTOOLS_GLOBAL_HOOK__',
      
      // Browser APIs that are not useful for web development
      'chrome', 'browser', 'webkitStorageInfo', 'webkitIndexedDB',
      'webkitRequestFileSystem', 'webkitResolveLocalFileSystemURL',
      
      // Internal browser functions
      'getComputedStyle', 'getSelection', 'matchMedia', 'requestAnimationFrame',
      'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback',
      
      // Performance and debugging
      'performance', 'console', 'onerror', 'onunhandledrejection',
      
      // Legacy/deprecated APIs
      'webkitURL', 'webkitAudioContext', 'webkitSpeechRecognition',
      'webkitSpeechGrammar', 'webkitSpeechGrammarList',
      
      // Internal state
      'closed', 'defaultStatus', 'status', 'toolbar', 'menubar',
      'scrollbars', 'personalbar', 'statusbar', 'locationbar',
      
      // Frame/window internals
      'frameElement', 'frames', 'length', 'parent', 'self', 'top',
      'opener', 'closed', 'defaultStatus', 'status'
    ],
    
    // Paths to completely skip (browser components)
    skipPaths: [
      // Chrome extension APIs
      /^window\.chrome/,
      /^window\.browser/,
      
      // DevTools
      /^window\.__devtools/,
      /^window\.__REACT_DEVTOOLS/,
      
      // Internal browser objects
      /^window\.webkitStorageInfo/,
      /^window\.webkitIndexedDB/,
      /^window\.performance/,
      /^window\.console/,
      
      // Navigation and history (usually not useful for debugging)
      /^window\.navigation/,
      /^window\.history/,
      /^window\.location/,
      
      // Large DOM collections that are rarely useful
      /^window\.document\.all/,
      /^window\.document\.anchors/,
      /^window\.document\.applets/,
      /^window\.document\.embeds/,
      /^window\.document\.forms/,
      /^window\.document\.images/,
      /^window\.document\.links/,
      /^window\.document\.plugins/,
      /^window\.document\.scripts/,
      /^window\.document\.styleSheets/,
      
      // Event handlers (too many and usually not useful)
      /^window\.on[a-z]+/,
      /^window\.document\.on[a-z]+/,
      
      // CSS and style internals
      /^window\.CSS/,
      /^window\.CSSStyleSheet/,
      /^window\.getComputedStyle/,
      
      // WebGL internals (keep high-level WebGL objects but skip internals)
      /^window\.WebGL.*\.prototype/,
      /^window\.webgl/i
    ],
    
    // Constructor names to skip (browser internals)
    skipConstructors: [
      'HTMLDocument', 'Document', 'Window', 'Navigator', 'Screen', 'History',
      'Location', 'Performance', 'Console', 'Storage', 'StyleSheetList',
      'HTMLCollection', 'NodeList', 'DOMTokenList', 'NamedNodeMap',
      'CSSStyleDeclaration', 'CSSRuleList', 'MediaQueryList',
      'WebGLRenderingContext', 'WebGL2RenderingContext'
    ]
  };

  // Check if a path should be skipped
  function shouldSkipPath(path) {
    return DEFAULT_BLACKLIST.skipPaths.some(pattern => {
      if (pattern instanceof RegExp) {
        return pattern.test(path);
      }
      return path.includes(pattern);
    });
  }

  // Check if an object should be skipped based on its constructor
  function shouldSkipObject(obj) {
    if (!obj || typeof obj !== 'object') return false;
    
    try {
      const constructorName = obj.constructor && obj.constructor.name;
      
      // Only skip the most problematic browser objects
      const problematicConstructors = [
        'HTMLDocument', 'Document', // Keep some DOM access but skip document itself
        'HTMLCollection', 'NodeList', 'DOMTokenList', // Large DOM collections
        'CSSStyleDeclaration', 'CSSRuleList', // CSS internals
        'WebGLRenderingContext', 'WebGL2RenderingContext' // WebGL contexts
      ];
      
      if (constructorName && problematicConstructors.includes(constructorName)) {
        return true;
      }
      
      // Skip very large collections (over 1000 items)
      if (obj.length !== undefined && obj.length > 1000) {
        return true;
      }
      
      // Allow most DOM nodes but skip document and very large collections
      if (obj.nodeType !== undefined) {
        // Skip document but allow body, head, and other useful elements
        if (obj === document) {
          return true;
        }
        // Allow other DOM elements as they might be useful for debugging
        return false;
      }
      
    } catch (e) {
      // If we can't check, don't skip
      return false;
    }
    
    return false;
  }

  // Get combined blacklist for properties
  function getPropertyBlacklist() {
    // Balanced blacklist - filters browser internals but keeps useful objects
    return [
      // Core object internals (always filter these)
      'constructor', 'prototype', '__proto__', '__defineGetter__', '__defineSetter__',
      '__lookupGetter__', '__lookupSetter__', 'hasOwnProperty', 'isPrototypeOf',
      'propertyIsEnumerable', 'toString', 'valueOf', 'toLocaleString',
      
      // Chrome DevTools (not useful for web development)
      '__devtools', '__devtoolsFormatters', '__REACT_DEVTOOLS_GLOBAL_HOOK__',
      
      // Browser-specific internals (not useful for debugging)
      'webkitStorageInfo', 'webkitIndexedDB', 'webkitRequestFileSystem', 
      'webkitResolveLocalFileSystemURL', 'webkitURL', 'webkitAudioContext',
      
      // Performance APIs (usually not needed for debugging)
      'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 
      'cancelIdleCallback',
      
      // Window frame internals (rarely useful)
      'frameElement', 'frames', 'opener', 'closed', 'defaultStatus', 'status',
      'toolbar', 'menubar', 'scrollbars', 'personalbar', 'statusbar', 'locationbar'
    ];
  }

  async function deepSearch(obj, searchTerm, { onPartialUpdate, charLimit = 500000, maxDepth = 5, blacklist = null, maxResults = 5000, mode = 'both', matchType = 'partial', searchId = null } = {}) {
    if (isCleanedUp || cancelSearch) return [];
    
    // Use comprehensive blacklist if none provided
    const effectiveBlacklist = blacklist || getPropertyBlacklist();
    
    const results = [];
    const visited = new WeakSet(); // Use WeakSet to allow garbage collection
    let totalChars = 0;
    let processedObjects = 0;
    const MAX_PROCESSED_OBJECTS = 50000; // Prevent infinite processing
    const isMatch = t => typeof t === 'string' && (matchType === 'full' ? t.toLowerCase() === searchTerm.toLowerCase() : t.toLowerCase().includes(searchTerm.toLowerCase()));

    // Using the global stringValue function now

    const queue = [{ current: obj, path: 'window', depth: 0 }];

    await new Promise(resolve => {
        function processBatch() {
            if (isCleanedUp || cancelSearch || (searchId && !activeSearches.has(searchId))) {
                resolve();
                return;
            }
            
            // Early termination for excessive processing
            if (processedObjects >= MAX_PROCESSED_OBJECTS) {
                window.postMessage({ type: 'FROM_INJECTED', action: 'status', data: 'Search terminated: Maximum objects processed' }, '*');
                onPartialUpdate(results, true);
                resolve();
                return;
            }
            
            const batchSize = 25; // Reduced batch size for better responsiveness
            for (let i = 0; i < batchSize && queue.length > 0; i++) {
                if (isCleanedUp || cancelSearch || (searchId && !activeSearches.has(searchId))) {
                    resolve();
                    return;
                }
                
                const peekItem = queue[0]; // Peek at first item
                // Post status update less frequently to reduce overhead
                if (processedObjects % 100 === 0) {
                    window.postMessage({ type: 'FROM_INJECTED', action: 'status', data: `Scanning: ${peekItem.path} (Depth: ${peekItem.depth}, Queue: ${queue.length})` }, '*');
                }

                const { current, path, depth } = queue.shift();
                processedObjects++;
                
                if (depth > maxDepth || totalChars >= charLimit || results.length >= maxResults) continue;

                if (current === null || (typeof current !== 'object' && typeof current !== 'function')) continue;

                if (visited.has(current)) continue;
                
                // Skip very large objects and clear browser internals
                if (shouldSkipObject(current)) continue;
                
                // Skip problematic browser internal paths
                if (shouldSkipPath(path)) continue;
                
                visited.add(current);

                let keys;
                try {
                    keys = Object.getOwnPropertyNames(current);
                } catch (e) {
                    continue;
                }

                for (const key of keys) {
                    if (effectiveBlacklist.includes(key)) continue;

                    const keyStr = String(key);
                    let newPath;
                    // Optimize path construction to reduce string allocations
                    if (hasNonVarChars(keyStr)) {
                        newPath = path + '[' + JSON.stringify(keyStr) + ']';
                    } else if (!isNaN(keyStr) && keyStr.trim() !== '') {
                        newPath = path + '[' + keyStr + ']';
                    } else {
                        newPath = path ? path + '.' + keyStr : keyStr;
                    }
                    
                    // Skip problematic browser internal paths
                    if (shouldSkipPath(newPath)) continue;
                    
                    let value;
                    try {
                        value = current[key];
                    } catch (e) {
                        continue;
                    }

                    try {
                    // Use the global stringValue function
                    const valueStr = stringValue(value);
                        const currentChars = newPath.length + valueStr.length;
                        const keyMatches = isMatch(key);
                        const valMatches = isMatch(valueStr);
                        const match = (mode === 'both' && (keyMatches || valMatches)) || (mode === 'key' && keyMatches) || (mode === 'value' && valMatches);

                        if (totalChars + currentChars > charLimit) continue;

                        if (match) {
                            // Store both the serialized value and safe original value for better handling
                            try {
                                results.push({ 
                                  path: newPath, 
                                  type: typeof value, 
                                  value: safeStringify(value),
                                  originalValue: safeValueForPostMessage(value)
                                });
                            } catch (pushError) {
                                // If we can't process this value, skip it and continue
                                console.warn('Error processing value at path:', newPath);
                                continue;
                            }
                            totalChars += currentChars;
                        }
                    } catch (valueError) {
                        // Skip this property if we can't process it
                        console.warn('Error processing property:', key);
                        continue;
                    }

                    if ((typeof value === 'object' || typeof value === 'function') && value !== null) {
                        // Temporarily disable filtering for queue population to debug limited results
                        // if (!shouldSkipObject(value) && !shouldSkipPath(newPath)) {
                            queue.push({ current: value, path: newPath, depth: depth + 1 });
                        // }
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
                const timeoutId = setTimeout(processBatch, 0);
                searchTimeouts.add(timeoutId);
                setTimeout(() => searchTimeouts.delete(timeoutId), 100);
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

  // Get object properties for expansion
  function getObjectProperties(objectPath) {
    try {
      const obj = getObjectByPath(objectPath);
      if (!obj || (typeof obj !== 'object' && typeof obj !== 'function')) {
        window.postMessage({
          type: 'FROM_INJECTED',
          action: 'objectProperties',
          path: objectPath,
          properties: [],
          success: false
        }, '*');
        return;
      }

      const properties = [];
      let keys = [];
      
      try {
        keys = Object.getOwnPropertyNames(obj);
      } catch (e) {
        console.warn(`Error getting property names for ${objectPath}:`, e);
        // Send empty properties array with success=true to avoid UI hanging
        window.postMessage({
          type: 'FROM_INJECTED',
          action: 'objectProperties',
          path: objectPath,
          properties: [],
          success: true,
          warning: `Could not access properties: ${e.message}`
        }, '*');
        return;
      }
      
      const blacklist = getPropertyBlacklist();
      let processedCount = 0;
      
      // Process only first 50 properties
      for (const key of keys.slice(0, 50)) {
        // Skip blacklisted properties
        if (blacklist.includes(key)) continue;
        
        try {
          let value;
          try {
            value = obj[key];
          } catch (e) {
            console.warn(`Error accessing property ${key}:`, e);
            continue; // Skip this property
          }
          
          const newPath = hasNonVarChars(key) ? `${objectPath}[${JSON.stringify(key)}]` : `${objectPath}.${key}`;
          
          // Skip paths that match browser internal patterns
          if (shouldSkipPath(newPath)) continue;
          
          let valueStr;
          try {
            // Use the global stringValue function
            valueStr = stringValue(value);
          } catch (e) {
            console.warn(`Error getting string value for ${key}:`, e);
            valueStr = '[Error getting value]';
          }
          
          let originalValue;
          try {
            originalValue = safeValueForPostMessage(value);
          } catch (e) {
            console.warn(`Error in safeValueForPostMessage for ${key}:`, e);
            originalValue = '[Error processing value]';
          }
          
          properties.push({
            path: newPath,
            key: key,
            value: valueStr,
            originalValue: originalValue,
            type: typeof value
          });
          
          processedCount++;
        } catch (e) {
          console.warn(`Error processing property ${key}:`, e);
          // Continue to next property
        }
      }

      console.log(`Successfully processed ${processedCount} properties for ${objectPath}`);
      
      window.postMessage({
        type: 'FROM_INJECTED',
        action: 'objectProperties',
        path: objectPath,
        properties: properties,
        success: true
      }, '*');
    } catch (e) {
      console.error(`Error in getObjectProperties for ${objectPath}:`, e);
      window.postMessage({
        type: 'FROM_INJECTED',
        action: 'objectProperties',
        path: objectPath,
        properties: [],
        success: false,
        error: e.message
      }, '*');
    }
  }

  // Explore within a specific object
  function exploreObject(objectPath, searchTerm, options) {
    try {
      const obj = getObjectByPath(objectPath);
      if (!obj) {
        window.postMessage({
          type: 'FROM_INJECTED',
          action: 'search_results',
          results: [],
          isDone: true
        }, '*');
        return;
      }

      // Use the existing deepSearch function but start from the specific object
      // and update the path to reflect the new root
      const modifiedOptions = { 
        ...options, 
        onPartialUpdate: options.onPartialUpdate,
        searchId: options.searchId
      };
      
      // Call deepSearch with the specific object as root, but adjust paths
      deepSearchWithCustomRoot(obj, objectPath, searchTerm, modifiedOptions);
    } catch (e) {
      window.postMessage({
        type: 'FROM_INJECTED',
        action: 'search_results',
        results: [],
        isDone: true
      }, '*');
    }
  }

  // Modified deepSearch for exploring specific objects
  async function deepSearchWithCustomRoot(obj, rootPath, searchTerm, { onPartialUpdate, charLimit = 100000000, maxDepth = 5, blacklist = null, maxResults = 1000, mode = 'both', matchType = 'partial', searchId = null } = {}) {
    if (isCleanedUp || cancelSearch) return [];
    
    // Use comprehensive blacklist if none provided
    const effectiveBlacklist = blacklist || getPropertyBlacklist();
    
    const results = [];
    const visited = new Set();
    let totalChars = 0;
    
    // Handle empty search term - if empty, match everything
    const isMatch = searchTerm && searchTerm.trim() ? 
      (t => typeof t === 'string' && (matchType === 'full' ? t.toLowerCase() === searchTerm.toLowerCase() : t.toLowerCase().includes(searchTerm.toLowerCase()))) :
      (t => true); // Match everything if no search term

    const queue = [{ current: obj, path: rootPath, depth: 0 }];

    await new Promise(resolve => {
        function processBatch() {
            if (isCleanedUp || cancelSearch || (searchId && !activeSearches.has(searchId))) {
                resolve();
                return;
            }
            
            const batchSize = 50;
            for (let i = 0; i < batchSize && queue.length > 0; i++) {
                if (isCleanedUp || cancelSearch || (searchId && !activeSearches.has(searchId))) {
                    resolve();
                    return;
                }
                
                const peekItem = queue[0]; // Peek at first item
                // Post status update
                window.postMessage({ type: 'FROM_INJECTED', action: 'status', data: `Exploring: ${peekItem.path} (Depth: ${peekItem.depth}, Queue: ${queue.length})` }, '*');

                const { current, path, depth } = queue.shift();
                if (depth > maxDepth || totalChars >= charLimit || results.length >= maxResults) continue;

                if (current === null || (typeof current !== 'object' && typeof current !== 'function')) continue;

                if (visited.has(current)) continue;
                
                // Skip browser internals and large objects
                if (shouldSkipObject(current)) continue;
                
                // Skip paths that match browser internal patterns
                if (shouldSkipPath(path)) continue;
                
                visited.add(current);

                let keys;
                try {
                    keys = Object.getOwnPropertyNames(current);
                } catch (e) {
                    continue;
                }

                for (const key of keys) {
                    if (effectiveBlacklist.includes(key)) continue;

                    const keyStr = String(key);
                    let newPath;
                    if (hasNonVarChars(keyStr)) {
                        newPath = `${path}[${JSON.stringify(keyStr)}]`;
                    } else if (!isNaN(keyStr) && keyStr.trim() !== '') {
                        newPath = `${path}[${keyStr}]`;
                    } else {
                        newPath = path ? `${path}.${keyStr}` : keyStr;
                    }
                    
                    // Skip this path if it matches browser internal patterns
                    if (shouldSkipPath(newPath)) continue;
                    
                    let value;
                    try {
                        value = current[key];
                    } catch (e) {
                        continue;
                    }

                    // Use the global stringValue function
                    const valueStr = stringValue(value);
                    const currentChars = newPath.length + valueStr.length;
                    const keyMatches = isMatch(key);
                    const valMatches = isMatch(valueStr);
                    const match = (mode === 'both' && (keyMatches || valMatches)) || (mode === 'key' && keyMatches) || (mode === 'value' && valMatches);

                    if (totalChars + currentChars > charLimit) continue;

                    if (match) {
                        // Store both the serialized value and safe original value for better handling
                        results.push({ 
                          path: newPath, 
                          type: typeof value, 
                          value: safeStringify(value),
                          originalValue: safeValueForPostMessage(value)
                        });
                        totalChars += currentChars;
                    }

                    if ((typeof value === 'object' || typeof value === 'function') && value !== null) {
                        // Don't queue browser internals for further exploration
                        if (!shouldSkipObject(value) && !shouldSkipPath(newPath)) {
                            queue.push({ current: value, path: newPath, depth: depth + 1 });
                        }
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
                const timeoutId = setTimeout(processBatch, 0);
                searchTimeouts.add(timeoutId);
                setTimeout(() => searchTimeouts.delete(timeoutId), 100);
              } else {
                window.postMessage({ type: 'FROM_INJECTED', action: 'status', data: 'Exploration complete.' }, '*');
                onPartialUpdate(results, true); // Final update
                resolve();
              }
        }
        processBatch();
    });

    return results;
  }

  // Global stringValue function to ensure it's available throughout the script
  function stringValue(val) {
    if (val === null) return 'null';
    if (typeof val === 'string') return val;
    if (typeof val === 'function') return val.toString();
    if (typeof val === 'object') {
      try {
        const objStr = Object.prototype.toString.call(val);
        return objStr === '[object Object]' ? JSON.stringify(val) : objStr;
      } catch (e) {
        return Object.prototype.toString.call(val);
      }
    }
    return String(val);
  }

  // Helper function to get object by path
  function getObjectByPath(path) {
    try {
      // Remove 'window.' prefix if present
      let cleanPath = path.replace(/^window\./, '');
      if (cleanPath === 'window' || cleanPath === '') {
        return window;
      }
      
      // Split the path and traverse the object
      let current = window;
      const parts = [];
      
      // Parse the path to handle both dot notation and bracket notation
      let i = 0;
      while (i < cleanPath.length) {
        if (cleanPath[i] === '.') {
          i++; // Skip the dot
          let prop = '';
          while (i < cleanPath.length && cleanPath[i] !== '.' && cleanPath[i] !== '[') {
            prop += cleanPath[i];
            i++;
          }
          if (prop) parts.push(prop);
        } else if (cleanPath[i] === '[') {
          i++; // Skip the opening bracket
          let prop = '';
          let inQuotes = false;
          let quoteChar = '';
          
          while (i < cleanPath.length) {
            if (!inQuotes && (cleanPath[i] === '"' || cleanPath[i] === "'")) {
              inQuotes = true;
              quoteChar = cleanPath[i];
              i++;
              continue;
            }
            if (inQuotes && cleanPath[i] === quoteChar) {
              inQuotes = false;
              i++;
              continue;
            }
            if (!inQuotes && cleanPath[i] === ']') {
              break;
            }
            prop += cleanPath[i];
            i++;
          }
          i++; // Skip the closing bracket
          
          // Handle numeric indices
          if (!isNaN(prop) && prop.trim() !== '') {
            parts.push(parseInt(prop));
          } else {
            parts.push(prop);
          }
        } else {
          // Handle the first property if it doesn't start with a dot
          let prop = '';
          while (i < cleanPath.length && cleanPath[i] !== '.' && cleanPath[i] !== '[') {
            prop += cleanPath[i];
            i++;
          }
          if (prop) parts.push(prop);
        }
      }
      
      // Traverse the object using the parsed parts
      for (const part of parts) {
        if (current === null || current === undefined) {
          return null;
        }
        current = current[part];
      }
      
      return current;
    } catch (e) {
      console.error('Error getting object by path:', e);
      return null;
    }
  }
})();