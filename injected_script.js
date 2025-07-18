// injected_script.js - Script that runs in the page context

(function() {
    let cancelSearch = false;
    let currentSearchResults = [];
    let currentSearchProcessed = 0;
    let activeSearchPromise = null;
    let searchTimeouts = new Set();
    let isSearchActive = false;
    
    // Helper functions
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
    
    function hasNonVarChars(name) {
        return typeof name !== 'string' || !/^[A-Za-z0-9_$]+$/.test(name);
    }
    
    // Removed caching system for simplicity - direct search is more reliable
    
    // Removed page change detection - no longer needed without caching
    
    // Helper function to send results in chunks
    function sendResultsInChunks(results, action, extraPayload = {}) {
        const chunkSize = 50; // Send results in chunks of 50
        
        if (results.length <= chunkSize) {
            // Small result set, send all at once
            window.postMessage({
                type: 'FROM_PAGE',
                action: action,
                payload: {
                    results: results,
                    ...extraPayload
                }
            }, '*');
            return;
        }
        
        // Large result set, send in chunks
        const totalChunks = Math.ceil(results.length / chunkSize);
        
        for (let i = 0; i < results.length; i += chunkSize) {
            const chunk = results.slice(i, i + chunkSize);
            const chunkIndex = Math.floor(i / chunkSize);
            const isLastChunk = i + chunkSize >= results.length;
            
            window.postMessage({
                type: 'FROM_PAGE',
                action: action,
                payload: {
                    results: chunk,
                    isChunk: true,
                    chunkIndex: chunkIndex,
                    totalChunks: totalChunks,
                    isLastChunk: isLastChunk,
                    ...extraPayload
                }
            }, '*');
        }
    }

    async function performSearch(searchTerm, maxDepth = 5, maxResults = 10000, mode = 'both', matchType = 'partial') {
        cancelSearch = false;
        currentSearchResults = [];
        currentSearchProcessed = 0;
        
        try {
            // Send initial status
            window.postMessage({
                type: 'FROM_PAGE',
                action: 'updateStatus',
                payload: 'Starting search...'
            }, '*');
            
            // Perform direct deep search - no caching complexity
            const results = await deepSearch(window, searchTerm, maxDepth, maxResults, 0, [], mode, matchType);
            
        } catch (error) {
            console.error('Search error:', error);
            window.postMessage({
                type: 'FROM_PAGE',
                action: 'searchError',
                payload: error.message
            }, '*');
        }
    }
    
    // Comprehensive cleanup function
    function performSearchCleanup(reason = 'cancelled') {
        console.log(`Performing search cleanup: ${reason}`);
        
        // Set cancellation flag
        cancelSearch = true;
        isSearchActive = false;
        
        // Clear all timeouts
        searchTimeouts.forEach(timeoutId => {
            clearTimeout(timeoutId);
        });
        searchTimeouts.clear();
        
        // Reset search state
        currentSearchResults = [];
        currentSearchProcessed = 0;
        
        // If there's an active search promise, it will check cancelSearch flag
        if (activeSearchPromise) {
            console.log('Active search will be cancelled on next iteration');
        }
        
        // Send cancellation confirmation
        window.postMessage({
            type: 'FROM_PAGE',
            action: 'searchCancelled',
            payload: { 
                message: `Search ${reason} - all processes stopped.`,
                reason: reason,
                timestamp: Date.now()
            }
        }, '*');
    }

    // Enhanced timeout wrapper that tracks timeouts
    function createTrackedTimeout(callback, delay) {
        const timeoutId = setTimeout(() => {
            searchTimeouts.delete(timeoutId);
            if (!cancelSearch) {
                callback();
            }
        }, delay);
        searchTimeouts.add(timeoutId);
        return timeoutId;
    }

    // Listen for messages from the content script
    window.addEventListener('message', async (event) => {
        if (event.source !== window || !event.data.type || event.data.type !== 'FROM_EXTENSION') {
            return;
        }

        if (event.data.action === 'startSearch') {
            // Reset cancellation flag and cleanup any previous search
            if (isSearchActive) {
                performSearchCleanup('replaced');
                // Wait a bit for cleanup to complete
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            
            cancelSearch = false;
            isSearchActive = true;
            
            const { term, maxDepth, maxResults, mode, matchType } = event.data.payload;
            
            console.log('Starting search with params:', { term, maxDepth, maxResults, mode, matchType });
            
            // Store the search promise to track active searches
            activeSearchPromise = performSearch(
                term, 
                maxDepth || 5, 
                maxResults || 10000, 
                mode || 'both', 
                matchType || 'partial'
            ).finally(() => {
                activeSearchPromise = null;
                isSearchActive = false;
            });
            
        } else if (event.data.action === 'cancelSearch') {
            performSearchCleanup('cancelled');
        } else if (event.data.action === 'outputFinalChunk') {
            // Output final chunk of results before stopping
            if (currentSearchResults && currentSearchResults.length > 0) {
                window.postMessage({
                    type: 'FROM_PAGE',
                    action: 'searchPartial',
                    payload: { 
                        results: currentSearchResults, 
                        isFinal: true,
                        processed: currentSearchProcessed || 0
                    }
                }, '*');
            }
        } else if (event.data.action === 'ping') {
            // Respond to ping to confirm content script is ready
            window.postMessage({
                type: 'FROM_PAGE',
                action: 'pong',
                payload: { success: true }
            }, '*');
        } else if (event.data.action === 'getObjectProperties') {
            const { path } = event.data.payload;
            try {
                // Navigate to the object using the path
                const obj = getObjectByPath(path);
                if (obj !== null && (typeof obj === 'object' || typeof obj === 'function')) {
                    const properties = [];
                    const keys = Object.getOwnPropertyNames(obj);
                    
                    for (const key of keys.slice(0, 1000)) { // Limit to first 1000 properties
                        try {
                            const value = obj[key];
                            const valueStr = stringValue(value);
                            properties.push({
                                key,
                                value: valueStr,
                                type: typeof value,
                                path: `${path}.${key}`
                            });
                        } catch (e) {
                            properties.push({
                                key,
                                value: '[Error accessing property]',
                                type: 'error',
                                path: `${path}.${key}`
                            });
                        }
                    }
                    
                    window.postMessage({
                        type: 'FROM_PAGE',
                        action: 'objectProperties',
                        payload: { properties, path }
                    }, '*');
                } else {
                    window.postMessage({
                        type: 'FROM_PAGE',
                        action: 'objectProperties',
                        payload: { properties: [], path, error: 'Object not found or not expandable' }
                    }, '*');
                }
            } catch (error) {
                window.postMessage({
                    type: 'FROM_PAGE',
                    action: 'objectProperties',
                    payload: { properties: [], path, error: error.message }
                }, '*');
            }
        } else if (event.data.action === 'exploreObject') {
            const { path, term, maxDepth, maxResults, mode, matchType } = event.data.payload;
            
            try {
                const targetObject = getObjectByPath(path);
                if (!targetObject) {
                    sendResultsInChunks([], 'exploreResults', { 
                        isFinal: true, 
                        basePath: path, 
                        error: 'Object not found' 
                    });
                    return;
                }
                
                // Use the new deepSearch function directly for exploration
                // deepSearch will handle chunking automatically
                await deepSearch(
                    targetObject, 
                    term, 
                    maxDepth || 3, 
                    maxResults || 50, 
                    0, 
                    [], 
                    mode || 'both', 
                    matchType || 'partial', 
                    'explore'
                );
                
            } catch (error) {
                console.error('Exploration error:', error);
                sendResultsInChunks([], 'exploreResults', { 
                    isFinal: true, 
                    basePath: path, 
                    error: error.message 
                });
            }
        }
    });

    // Helper: Get object by path
    function getObjectByPath(path) {
        try {
            // Start from window object
            let obj = window;
            
            // Handle simple 'window' path
            if (path === 'window') {
                return obj;
            }
            
            // Remove 'window.' prefix if present
            if (path.startsWith('window.')) {
                path = path.substring(7);
            }
            
            // Split path and navigate
            const parts = path.split('.');
            for (const part of parts) {
                if (part.includes('[') && part.includes(']')) {
                    // Handle array/object notation like obj[0] or obj["key"]
                    const match = part.match(/^([^[]+)\[(.+)\]$/);
                    if (match) {
                        const [, prop, index] = match;
                        if (prop) {
                            obj = obj[prop];
                        }
                        // Remove quotes if present
                        const cleanIndex = index.replace(/^["']|["']$/g, '');
                        obj = obj[cleanIndex];
                    } else {
                        obj = obj[part];
                    }
                } else {
                    obj = obj[part];
                }
                
                if (obj === undefined || obj === null) {
                    return null;
                }
            }
            
            return obj;
        } catch (error) {
            console.error('Error navigating to path:', path, error);
            return null;
        }
    }

    // Helper: Optimized value serialization
    function serializeValue(value) {
        try {
            if (typeof value === 'function') {
                return value.toString();
            }
            if (typeof value === 'object' && value !== null) {
                try {
                    return JSON.stringify(value);
                } catch (e) {
                    return Object.prototype.toString.call(value);
                }
            }
            return value;
        } catch (e) {
            return '[Unserializable]';
        }
    }

    // Helper: Safe Stringify
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
    
    async function deepSearch(rootObj, searchTerm, maxDepth, maxResults, startDepth = 0, existingResults = [], mode = 'both', matchType = 'partial', actionType = 'search') {
        const results = [...existingResults];
        const searchTermLower = searchTerm.toLowerCase();
        const batchSize = 50;
        const maxQueueSize = 3000;
        const charLimit = 100000000; // 100 million characters
        let totalChars = 0;
        const resultsPushFrequency = 25; // How often to push partial results

        // Track current search results globally
        currentSearchResults = results;
        currentSearchProcessed = 0;
        
        // Create match function based on matchType
        const isMatch = (text) => {
            const textLower = text.toLowerCase();
            return matchType === 'full' ? textLower === searchTermLower : textLower.includes(searchTermLower);
        };
        
        // Optimized blacklist as Set for O(1) lookup
        const internalBlacklist = new Set([
            'constructor', 'prototype', '__proto__', '__defineGetter__', '__defineSetter__', 
            '__lookupGetter__', '__lookupSetter__', 'isPrototypeOf', 'hasOwnProperty', 
            'valueOf', 'toLocaleString', 'toString', 'propertyIsEnumerable', 'apply', 'call', 'bind'
        ]);
        const queue = [{ current: rootObj, path: 'window', depth: startDepth }];
        const visited = new Set();

        async function processQueue() {
            if (cancelSearch) {
                performSearchCleanup('cancelled');
                return;
            }

            const batchStartTime = Date.now();
            let processedInBatch = 0;

            while (queue.length > 0 && processedInBatch < batchSize && (Date.now() - batchStartTime < 50)) {
                if (cancelSearch) break;

                const { current, path, depth } = queue.shift();
                currentSearchProcessed++;
                processedInBatch++;

                if (!current || depth > maxDepth || results.length >= maxResults || totalChars >= charLimit) continue;

                if (visited.has(current)) continue;
                visited.add(current);

                if (shouldSkipPath(path, searchTerm, depth)) continue;

                try {
                    const keys = Object.getOwnPropertyNames(current);
                    for (const key of keys) {
                        if (cancelSearch) break;
                        if (internalBlacklist.has(key)) continue;

                        let value;
                        try {
                            value = current[key];
                        } catch (e) { continue; }

                        const newPath = hasNonVarChars(key) ? `${path}["${key}"]` : `${path}.${key}`;
                        if (shouldSkipPath(newPath, searchTerm, depth + 1)) continue;

                        const valueStr = stringValue(value);
                        const currentChars = newPath.length + (valueStr ? valueStr.length : 0);

                        if (totalChars + currentChars >= charLimit) {
                            console.warn('Character limit reached. Stopping search.');
                            cancelSearch = true; 
                            break;
                        }

                        const keyMatches = mode !== 'value' && isMatch(key);
                        const valMatches = mode !== 'key' && valueStr && isMatch(valueStr);

                        if (keyMatches || valMatches) {
                            results.push({ path: newPath, value: value, type: typeof value });
                            totalChars += currentChars;
                        }

                        if (value && (typeof value === 'object' || typeof value === 'function') && depth < maxDepth) {
                            if (queue.length > maxQueueSize) {
                                console.warn(`Queue size > ${maxQueueSize}. Slicing.`);
                                queue.splice(maxQueueSize / 3);
                            }
                            queue.push({ current: value, path: newPath, depth: depth + 1 });
                        }
                    }
                } catch (e) { /* Ignore errors from accessing properties */ }
            }

            // Partial update
            if (results.length > 0 && (results.length % resultsPushFrequency === 0 || queue.length === 0)) {
                sendResultsInChunks(results, actionType === 'explore' ? 'exploreResults' : 'searchPartial', {
                    isFinal: false,
                    processed: currentSearchProcessed,
                    basePath: actionType === 'explore' ? rootObj.path : undefined
                });
            }

            if (queue.length > 0 && !cancelSearch) {
                createTrackedTimeout(processQueue, 0); // Yield to main thread
            } else {
                // Final results
                sendResultsInChunks(results, actionType === 'explore' ? 'exploreResults' : 'searchPartial', {
                    isFinal: true,
                    processed: currentSearchProcessed,
                    basePath: actionType === 'explore' ? rootObj.path : undefined
                });
                isSearchActive = false;
            }
        }

        processQueue();
    }

    // Path filtering for non-essential objects (can be bypassed if search term specifically targets them)
    const shouldSkipPath = (path, searchTerm, depth = 0) => {
            // Developer patterns that should NEVER be skipped (highest priority)
            const developerPatterns = [
                /window\.myapp/i,
                /window\.config(?!Data)/i, // Allow window.config but not window.configData
                /window\.data(?!.*test)/i, // Allow window.data but not test-related data
                /window\.api/i,
                /window\.store/i,
                /window\.state/i,
                /window\.user/i,
                /window\.custom/i,
                /window\.project/i,
                /window\.settings/i,
                /window\.env/i,
                /window\.globals/i,
                /window\.[a-zA-Z]+(?<!test|mock|spec)$/i // Custom variables not ending in test/mock/spec
            ];
            
            // Check if this is a developer-accessible variable
            for (const pattern of developerPatterns) {
                if (pattern.test(path)) {
                    return false; // Never skip developer variables
                }
            }
            
            // Skip patterns for test/debug data, framework internals, and browser APIs
            const skipPatterns = [
                // Test and debug data
                /window\.testData/i,
                /window\.configData/i,
                /window\.searchableData/i,
                /test|debug|mock|spec|fixture|stub/i,
                /\.test\.|\.debug\.|\.mock\./i,
                
                // Framework and library internals
                /angular|react|vue|jquery|\$|_|lodash|moment/i,
                /webpack|babel|rollup|parcel/i,
                /node_modules|vendor|lib|dist/i,
                
                // Browser extension internals
                /chrome\.runtime|chrome\.extension|chrome\.tabs/i,
                /extension|addon|plugin/i,
                
                // Browser security and reporting APIs
                /SecurityPolicyViolation|ContentSecurityPolicy/i,
                /ReportingObserver|Report|Violation/i,
                /PerformanceObserver|Performance|Navigation/i,
                
                // Circular window references and browser internals with stricter repeated patterns
                /globalThis\.globalThis/i,  // Skip any path with globalThis.globalThis
                /(globalThis\.)+frames/i,   // Skip globalThis chains leading to frames
                /frames\.(globalThis\.)+/i, // Skip frames leading to globalThis chains
                /window\.window\.|window\.self\.|window\.top\.|window\.parent\./i,
                /window\.frames\./i,
                /window\.globalThis\./i,
                /\.frames\./i,
                /\.globalThis\./i,
                
                // Internal constructors and prototypes
                /\.constructor\.|\.prototype\.|__proto__|__defineGetter__|__defineSetter__/i,
                
                // WebAPI internals that developers don't typically modify
                /Audio|Video|Media|Web|HTML|CSS|DOM|SVG|XML/i,
                /Event$|Handler$|Listener$/i,
                /Observer$/i,
                /Observable$/i,
                /Element$|Node$/i,
                /Interface$/i,
                /Collection$/i,
                
                // Large DOM collections
                /document\.(all|forms|images|links|scripts|stylesheets)/i,
                /\.children\.|\.childNodes\./i,
                
                // Browser internal objects
                /Window$|Document$|Navigator$|History$|Location$/i,
                /Storage$|Cache$|Database$/i
            ];
            
            // Check if user is specifically searching for a filtered term (bypass filtering)
            const searchTermLower = searchTerm.toLowerCase();
            for (const pattern of skipPatterns) {
                if (typeof pattern === 'string' && pattern.toLowerCase().includes(searchTermLower)) {
                    return false; // Don't skip if user is searching for this
                } else if (pattern instanceof RegExp) {
                    const patternStr = pattern.source.toLowerCase();
                    if (patternStr.includes(searchTermLower) || pattern.test(searchTerm)) {
                        return false; // Don't skip if user is searching for this
                    }
                }
            }
            
            // Apply skip patterns
            for (const pattern of skipPatterns) {
                if (pattern.test(path)) {
                    return true;
                }
            }
            
            // Very aggressive filtering for browser internals - stop at depth 1
            const isBrowserInternal = /window\.(window|top|parent|frames|globalThis)\./i.test(path) ||
                                     /\.frames\./i.test(path) ||
                                     /\.globalThis\./i.test(path) ||
                                     /ReportBody/i.test(path) ||
                                     /Observer$/i.test(path) ||
                                     /Observable$/i.test(path) ||
                                     /Event$/i.test(path);
            
            if (isBrowserInternal && depth > 1) {
                return true;
            }
            
            // General deep path filtering - reduced from 4 to 3
            if (depth > 3) {
                return true;
            }
            
            return false;
        };
        
        let queue = [{ obj: rootObj, path: 'window', depth: 0 }];
        const batchSize = 50; // Back to original batch size like the archived script
        const maxQueueSize = 3000; // Reduced further to prevent browser internal explosion
        const charLimit = 100000000; // Character limit like original script
        const resultsPushFrequency = 25; // Push results every 25 items found
        let processed = 0;
        let skipped = 0;
        let lastResultsPush = 0;
        let totalChars = 0; // Track total character usage like original script
        
        while (queue.length > 0 && !cancelSearch) {
            // Check queue size limit - dump results and continue with reduced queue
            if (queue.length > maxQueueSize) {
                console.warn(`Queue size exceeded ${maxQueueSize}, dumping current results and continuing with reduced queue`);
                
                // Send current results immediately
                if (results.length > 0) {
                    const partialAction = actionType === 'explore' ? 'exploreResults' : 'searchPartial';
                    sendResultsInChunks([...results], partialAction, {
                        fromCache: false,
                        processed: processed,
                        remaining: queue.length,
                        skipped: skipped,
                        isFinal: false,
                        queueReduced: true
                    });
                    lastResultsPush = results.length;
                }
                
                // Reduce queue size by keeping only the most promising paths (lower depth)
                queue.sort((a, b) => a.depth - b.depth);
                queue = queue.slice(0, Math.floor(maxQueueSize / 3)); // More aggressive reduction
                console.log(`Queue reduced to ${queue.length} items, continuing search...`);
            }
            
            // Check character limit like original script
            if (totalChars >= charLimit) {
                console.warn(`Character limit of ${charLimit} reached, stopping search`);
                break;
            }
            
            const batch = queue.splice(0, batchSize);
            
            // Send status update with current path being searched
            if (batch.length > 0) {
                const currentItem = batch[0];
                const statusMessage = skipped > 0 
                    ? `Searching: ${currentItem.path} (Depth: ${currentItem.depth}, Queue: ${queue.length + batch.length}, Skipped: ${skipped} filtered paths)`
                    : `Searching: ${currentItem.path} (Depth: ${currentItem.depth}, Queue: ${queue.length + batch.length})`;
                
                window.postMessage({
                    type: 'FROM_PAGE',
                    action: 'updateStatus',
                    payload: statusMessage
                }, '*');
            }
            
            for (const item of batch) {
                if (cancelSearch) break;
                
                const { obj, path, depth } = item;
                
                if (depth > maxDepth) continue;
                
                // Skip non-essential paths unless user is specifically searching for them
                if (shouldSkipPath(path, searchTerm, depth)) {
                    skipped++;
                    continue;
                }
                
                try {
                    const keys = Object.getOwnPropertyNames(obj);
                    
                    for (const key of keys) {
                        if (cancelSearch) break;
                        
                        if (internalBlacklist.has(key)) continue;
                        
                        try {
                            const value = obj[key];
                            const keyStr = String(key);
                            let newPath;
                            if (hasNonVarChars(keyStr)) { 
                                newPath = `${path}[${JSON.stringify(keyStr)}]`; 
                            } else if (!isNaN(keyStr) && keyStr.trim() !== '') { 
                                newPath = `${path}[${keyStr}]`; 
                            } else { 
                                newPath = path ? `${path}.${keyStr}` : keyStr; 
                            }
                            
                            // Skip adding to queue if this path should be filtered (but still check for matches)
                            const shouldSkipTraversal = shouldSkipPath(newPath, searchTerm, depth + 1);
                            
                            const valueStr = stringValue(value);
                            
                            // Apply mode and matchType logic
                            const keyMatches = isMatch(keyStr);
                            const valueMatches = isMatch(valueStr);
                            
                            const match = (mode === 'both' && (keyMatches || valueMatches)) || 
                                         (mode === 'key' && keyMatches) || 
                                         (mode === 'value' && valueMatches);
                            
                            if (match) {
                                const currentChars = newPath.length + valueStr.length;
                                
                                // Check character limit before adding result (like original script)
                                if (totalChars + currentChars <= charLimit) {
                                    results.push({
                                        path: newPath,
                                        key: key,
                                        value: valueStr,
                                        originalValue: serializeValue(value),
                                        type: typeof value,
                                        depth: depth + 1,
                                        isTestData: shouldSkipTraversal // Mark test data for UI indication
                                    });
                                    
                                    totalChars += currentChars; // Track character usage
                                    
                                    // Update global tracking
                                    currentSearchResults = [...results];
                                    
                                    // Push results more frequently to save memory
                                    if (results.length - lastResultsPush >= resultsPushFrequency) {
                                        const partialAction = actionType === 'explore' ? 'exploreResults' : 'searchPartial';
                                        sendResultsInChunks([...results], partialAction, {
                                            fromCache: false,
                                            processed: processed,
                                            remaining: queue.length,
                                            skipped: skipped,
                                            isFinal: false
                                        });
                                        lastResultsPush = results.length;
                                    }
                                    
                                    // If we hit maxResults, dump them and continue searching
                                    if (results.length >= maxResults) {
                                        console.log(`Reached ${maxResults} results, dumping and continuing search...`);
                                        const partialAction = actionType === 'explore' ? 'exploreResults' : 'searchPartial';
                                        sendResultsInChunks([...results], partialAction, {
                                            fromCache: false,
                                            processed: processed,
                                            remaining: queue.length,
                                            skipped: skipped,
                                            isFinal: false,
                                            resultsDumped: true
                                        });
                                        
                                        // Reset results array to continue collecting more
                                        results = [];
                                        lastResultsPush = 0;
                                        totalChars = 0; // Reset character count too
                                    }
                                } else {
                                    // Skip this result due to character limit
                                    console.log(`Skipping result due to character limit: ${newPath}`);
                                }
                            }
                            
                            // Only add to queue if not filtered and within depth limits
                            if (!shouldSkipTraversal && 
                                (typeof value === 'object' || typeof value === 'function') && 
                                value !== null && depth < maxDepth) {
                                queue.push({ obj: value, path: newPath, depth: depth + 1 });
                            } else if (shouldSkipTraversal) {
                                skipped++;
                            }
                        } catch (e) {
                            continue;
                        }
                    }
                } catch (e) {
                    continue;
                }
                
                processed++;
                currentSearchProcessed = processed;
            }
            
            // Periodic memory cleanup - force garbage collection hints
            if (processed % 100 === 0) {
                // Clear any large temporary objects
                if (typeof window.gc === 'function') {
                    window.gc(); // Force garbage collection if available
                }
            }
            

        }
        
        // Check if search was cancelled and send appropriate message
        if (cancelSearch) {
            const cancelAction = actionType === 'explore' ? 'exploreResults' : 'searchCancelled';
            sendResultsInChunks(results, cancelAction, {
                reason: 'cancelled',
                processed: processed,
                skipped: skipped
            });
        } else {
            // Send final results if not cancelled
            const completeAction = actionType === 'explore' ? 'exploreResults' : 'searchComplete';
            sendResultsInChunks(results, completeAction, {
                processed: processed,
                skipped: skipped,
                isFinal: true
            });
        }
        
        return results;
    });




    // Handle page lifecycle events
    window.addEventListener('beforeunload', () => {

        console.log('Page beforeunload - cleaning up search processes');
        performSearchCleanup('page_unload');
    });

    window.addEventListener('pagehide', () => {
        console.log('Page pagehide - cleaning up search processes');
        performSearchCleanup('page_hidden');
    });

    // Handle visibility changes (tab switching, minimizing)
    document.addEventListener('visibilitychange', () => {
        if (document.hidden && isSearchActive) {
            console.log('Page hidden during search - processes will continue');
            // Don't cancel search on visibility change, just log it
        }
    });

// Add missing function to fix declaration error
function shouldSkipPath(path, searchTerm, depth = 0) {
    // Developer patterns that should NEVER be skipped (highest priority)
    const developerPatterns = [
        /window\.myapp/i,
        /window\.config(?!Data)/i,
        /window\.data(?!.*test)/i,
        /window\.api/i,
        /window\.store/i,
        /window\.state/i,
        /window\.user/i,
        /window\.custom/i,
        /window\.project/i,
        /window\.settings/i,
        /window\.env/i,
        /window\.globals/i,
        /window\.[a-zA-Z]+(?<!test|mock|spec)$/i
    ];

    // Check developer patterns first
    for (const pattern of developerPatterns) {
        if (pattern.test(path)) {
            return false;
        }
    }

    // Skip patterns for common test/debug/internal paths
    const skipPatterns = [
        /window\.testData/i,
        /window\.configData/i,
        /window\.searchableData/i,
        /test|debug|mock|spec|fixture|stub/i,
        /\.test\.|\.debug\.|\.mock\./i,
        /angular|react|vue|jquery|\$|_|lodash|moment/i,
        /webpack|babel|rollup|parcel/i,
        /node_modules|vendor|lib|dist/i
    ];

    // Skip if matches any skip pattern
    return skipPatterns.some(pattern => pattern.test(path));
}

})(); // End of IIFE
