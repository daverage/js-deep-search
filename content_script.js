// content_script.js

// Inject the script into the page context
function injectScript() {
    if (document.getElementById('deep-search-injected')) return;
    
    // Check if extension context is valid before injecting
    if (!isExtensionContextValid()) {
        console.log('Content script: Cannot inject script - extension context invalidated');
        return;
    }
    
    try {
        const script = document.createElement('script');
        script.id = 'deep-search-injected';
        script.src = chrome.runtime.getURL('injected_script.js');
        script.onload = () => script.remove();
        script.onerror = () => {
            console.log('Content script: Failed to load injected script');
            script.remove();
        };
        (document.head || document.documentElement).appendChild(script);
    } catch (error) {
        console.log('Content script: Error injecting script:', error.message);
    }
}

// Optimized chunking configuration
const CHUNK_CONFIG = {
    searchResults: { maxSize: 100, chunkSize: 50 },
    objectProperties: { maxSize: 200, chunkSize: 100 },
    exploreResults: { maxSize: 100, chunkSize: 50 }
};

// Extension context validation
function isExtensionContextValid() {
    try {
        return !!(chrome && chrome.runtime && chrome.runtime.id);
    } catch (error) {
        return false;
    }
}

// Safe message sending with context validation
function safeSendMessage(message, callback) {
    if (!isExtensionContextValid()) {
        console.log('Content script: Extension context invalidated, cannot send message');
        if (callback) callback({ error: 'Extension context invalidated' });
        return false;
    }
    
    try {
        chrome.runtime.sendMessage(message, (response) => {
            if (chrome.runtime.lastError) {
                console.log('Content script: Message send error:', chrome.runtime.lastError.message);
                if (callback) callback({ error: chrome.runtime.lastError.message });
            } else {
                if (callback) callback(response);
            }
        });
        return true;
    } catch (error) {
        console.log('Content script: Exception sending message:', error.message);
        if (callback) callback({ error: error.message });
        return false;
    }
}

// Generic chunking function for all data types
function sendDataInChunks(data, action, metadata = {}) {
    if (!isExtensionContextValid()) {
        console.log('Content script: Cannot send chunks - extension context invalidated');
        return;
    }
    
    const config = CHUNK_CONFIG[action] || { maxSize: 100, chunkSize: 50 };
    
    if (data.length <= config.maxSize) {
        safeSendMessage({
            action,
            payload: data,
            metadata: { ...metadata, isChunked: false }
        });
        return;
    }
    
    // Send data in chunks
    for (let i = 0; i < data.length; i += config.chunkSize) {
        const chunk = data.slice(i, i + config.chunkSize);
        const isLastChunk = i + config.chunkSize >= data.length;
        
        safeSendMessage({
            action,
            payload: chunk,
            metadata: {
                ...metadata,
                isChunked: true,
                chunkIndex: Math.floor(i / config.chunkSize),
                isLastChunk,
                totalItems: data.length
            }
        });
    }
}

// Consolidated message handler for injected script
function handleInjectedMessage(event) {
    if (event.source !== window || event.data.type !== 'FROM_PAGE') return;
    
    // Check extension context before processing
    if (!isExtensionContextValid()) {
        console.log('Content script: Extension context invalidated, ignoring message from injected script');
        return;
    }
    
    const { action, payload, metadata } = event.data;
    
    switch (action) {
        case 'searchResults':
        case 'searchPartial':
        case 'searchComplete':
            sendDataInChunks(payload, 'searchResults', metadata);
            break;
            
        case 'objectProperties':
            sendDataInChunks(payload, 'objectProperties', metadata);
            break;
            
        case 'exploreResults':
            sendDataInChunks(payload, 'exploreResults', metadata);
            break;
            
        case 'updateStatus':
        case 'searchCancelled':
        case 'searchError':
        case 'pong':
            // Forward these messages directly without chunking
            safeSendMessage({ action, payload, metadata });
            break;
    }
}

// Message handler for extension requests
function handleExtensionMessage(request, sender, sendResponse) {
    // Validate extension context first
    if (!isExtensionContextValid()) {
        console.log('Content script: Extension context invalidated, cannot handle message');
        sendResponse({ success: false, error: 'Extension context invalidated' });
        return false;
    }
    
    const { action, payload } = request;
    
    // Inject script if needed
    injectScript();
    
    // Handle different actions with appropriate response patterns
    switch (action) {
        case 'executeSearch':
            // For search execution, we need to wait for the injected script to be ready
            // and then send a response once the search has started
            window.postMessage({
                type: 'FROM_EXTENSION',
                action: 'startSearch',
                payload
            }, '*');
            
            // Send response immediately to prevent message channel timeout
            sendResponse({ success: true, message: 'Search initiated' });
            return false; // Synchronous response
            
        case 'ping':
        case 'cancelSearch':
            // Forward message to injected script
            window.postMessage({
                type: 'FROM_EXTENSION',
                action,
                payload
            }, '*');
            
            // Send immediate response
            sendResponse({ success: true });
            return false; // Synchronous response
            
        case 'getObjectProperties':
        case 'exploreObject':
            // Forward message to injected script
            window.postMessage({
                type: 'FROM_EXTENSION',
                action,
                payload
            }, '*');
            
            // Send immediate response for these actions too
            sendResponse({ success: true, message: `${action} initiated` });
            return false; // Synchronous response
            
        default:
            // Forward other messages
            window.postMessage({
                type: 'FROM_EXTENSION',
                action,
                payload
            }, '*');
            
            sendResponse({ success: true });
            return false; // Synchronous response
    }
}

// Initialize content script
function initialize() {
    // Set up message listeners
    window.addEventListener('message', handleInjectedMessage);
    chrome.runtime.onMessage.addListener(handleExtensionMessage);
    
    // Handle page lifecycle events
    window.addEventListener('beforeunload', () => {
        console.log('Content script: Page beforeunload - sending cleanup signal');
        // Send cleanup message to injected script
        window.postMessage({
            type: 'FROM_EXTENSION',
            action: 'cancelSearch',
            payload: { reason: 'page_unload' }
        }, '*');
    });
    
    // Inject script immediately if DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', injectScript);
    } else {
        injectScript();
    }
}

// Start the content script
initialize();