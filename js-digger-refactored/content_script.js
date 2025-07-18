// Inject the injected_script.js into the page
const script = document.createElement('script');
script.src = chrome.runtime.getURL('injected_script.js');
(document.head || document.documentElement).appendChild(script);

// Listen for messages from the background script
chrome.runtime.onMessage.addListener((request) => {
  // Forward messages to the injected script with proper type
  window.postMessage({ ...request, type: 'FROM_CONTENT' }, '*');
});

// Listen for messages from the injected script
window.addEventListener('message', (event) => {
  // We only accept messages from ourselves
  if (event.source !== window) {
    return;
  }

  if (event.data.type && (event.data.type === 'FROM_INJECTED')) {
    // Forward messages to the background script
    chrome.runtime.sendMessage(event.data);
  }
}, false);

// Let the background script know that the content script is ready
chrome.runtime.sendMessage({ type: 'content_script_ready' });