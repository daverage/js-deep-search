// Content script for JS Deep Search extension
let injectedScriptAdded = false;
let isCleanedUp = false;

function injectScript() {
  if (injectedScriptAdded || isCleanedUp) return;
  
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('injected_script.js');
  script.onload = function() {
    this.remove();
  };
  (document.head || document.documentElement).appendChild(script);
  injectedScriptAdded = true;
}

// Inject the script immediately
injectScript();

// Listen for messages from background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (isCleanedUp) return;
  
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
});

// Listen for messages from injected script
window.addEventListener('message', (event) => {
  if (isCleanedUp) return;
  
  if (event.source !== window) return;
  if (event.data.type !== 'FROM_INJECTED') return;
  
  // Forward to background script
  chrome.runtime.sendMessage(event.data);
});

// Notify background that content script is ready
chrome.runtime.sendMessage({ type: 'content_script_ready' });

// Cleanup when page unloads
window.addEventListener('beforeunload', () => {
  isCleanedUp = true;
});