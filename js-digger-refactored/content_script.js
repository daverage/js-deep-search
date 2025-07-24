// Content script for JS Deep Search extension
// Use var to allow redeclaration if script runs multiple times
var injectedScriptAdded = window.jsDeepSearchInjectedScriptAdded || false;
var isCleanedUp = false;
var hasWarnedAboutInvalidContext = false; // Prevent warning loops

// Initialize the global flag if not already set
if (typeof window.jsDeepSearchInjectedScriptAdded === 'undefined') {
  window.jsDeepSearchInjectedScriptAdded = false;
}

function injectScript() {
  if (window.jsDeepSearchInjectedScriptAdded || isCleanedUp) return;
  
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('injected_script.js');
  script.onload = function() {
    this.remove();
  };
  (document.head || document.documentElement).appendChild(script);
  window.jsDeepSearchInjectedScriptAdded = true;
  injectedScriptAdded = true;
}

// Inject the script immediately
injectScript();

// Function to check if extension context is valid
function isExtensionContextValid() {
  try {
    return !!(chrome && chrome.runtime && chrome.runtime.id);
  } catch (error) {
    return false;
  }
}

// Listen for messages from background script
if (isExtensionContextValid()) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (isCleanedUp || !isExtensionContextValid()) return;
    
    try {
      if (message.action === 'cleanup') {
        // Perform cleanup
        isCleanedUp = true;
        
        // Send cleanup message to injected script
        window.postMessage({ 
          type: 'TO_INJECTED', 
          action: 'cleanup' 
        }, '*');
        
        console.log('Content script cleaned up for tab:', message.tabId);
        return;
      }
      
      // Forward other messages to injected script
      window.postMessage({ 
        type: 'TO_INJECTED', 
        ...message 
      }, '*');
    } catch (error) {
      if (!hasWarnedAboutInvalidContext) {
        console.warn('Extension context invalidated during message handling');
        hasWarnedAboutInvalidContext = true;
      }
      isCleanedUp = true;
    }
  });
}

// Listen for messages from injected script
window.addEventListener('message', (event) => {
  if (isCleanedUp || !isExtensionContextValid()) return;
  
  if (event.source !== window) return;
  if (event.data.type !== 'FROM_INJECTED') return;
  
  // Forward to background script with comprehensive error handling
  try {
    if (isExtensionContextValid()) {
      chrome.runtime.sendMessage(event.data);
    } else {
      if (!hasWarnedAboutInvalidContext) {
        console.warn('Extension context invalidated, cannot send message');
        hasWarnedAboutInvalidContext = true;
      }
      isCleanedUp = true;
    }
  } catch (error) {
    if (!hasWarnedAboutInvalidContext) {
      console.warn('Extension context invalidated during message forwarding');
      hasWarnedAboutInvalidContext = true;
    }
    isCleanedUp = true;
    // Silently handle the error without throwing
  }
});

// Notify background that content script is ready with comprehensive error handling
if (isExtensionContextValid()) {
  try {
    chrome.runtime.sendMessage({ type: 'content_script_ready' });
  } catch (error) {
    if (!hasWarnedAboutInvalidContext) {
      console.warn('Extension context invalidated during initialization');
      hasWarnedAboutInvalidContext = true;
    }
    isCleanedUp = true;
  }
}

// Cleanup when page unloads
window.addEventListener('beforeunload', () => {
  isCleanedUp = true;
});

// Periodic check for extension context validity
var contextCheckInterval = setInterval(() => {
  if (!isExtensionContextValid()) {
    if (!hasWarnedAboutInvalidContext) {
      console.warn('Extension context invalidated, cleaning up');
      hasWarnedAboutInvalidContext = true;
    }
    isCleanedUp = true;
    clearInterval(contextCheckInterval);
  }
  
  // Stop checking if already cleaned up
  if (isCleanedUp) {
    clearInterval(contextCheckInterval);
  }
}, 5000); // Check every 5 seconds

// Also check when the page becomes visible again
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    try {
      if (!isExtensionContextValid()) {
        if (!hasWarnedAboutInvalidContext) {
          console.warn('Extension context invalidated on visibility change');
          hasWarnedAboutInvalidContext = true;
        }
        isCleanedUp = true;
        if (contextCheckInterval) {
          clearInterval(contextCheckInterval);
        }
      }
    } catch (error) {
      // Extension context is completely invalidated
      if (!hasWarnedAboutInvalidContext) {
        console.warn('Extension context completely invalidated on visibility change');
        hasWarnedAboutInvalidContext = true;
      }
      isCleanedUp = true;
      if (contextCheckInterval) {
        clearInterval(contextCheckInterval);
      }
    }
  }
});