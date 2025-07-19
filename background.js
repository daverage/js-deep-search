const connections = {};
const messageQueue = {};
const contentScriptReady = {};

chrome.runtime.onConnect.addListener(function (port) {
  if (port.name !== 'devtools-page') {
    return;
  }

    port.onMessage.addListener((message) => {
    if (message.name === 'init') {
      port.tabId = message.tabId;
      connections[port.tabId] = port;
      // Inject the content script programmatically
      chrome.scripting.executeScript({
        target: { tabId: message.tabId },
        files: ['content_script.js'],
      }, () => {
          if (chrome.runtime.lastError) {
            console.error(`Error injecting script: ${chrome.runtime.lastError.message}`);
          }
      });
      return;
    }

    // All other messages are relayed to the content script
    const tabId = port.tabId;
    if (contentScriptReady[tabId]) {
      chrome.tabs.sendMessage(tabId, message);
    } else {
      if (!messageQueue[tabId]) {
        messageQueue[tabId] = [];
      }
      messageQueue[tabId].push(message);
    }
  });

  port.onDisconnect.addListener(function (port) {
    if (port.tabId) {
      // Clean up all resources for this tab
      const tabId = port.tabId;
      
      // Send cleanup message to content script before removing connection
      if (contentScriptReady[tabId]) {
        chrome.tabs.sendMessage(tabId, { 
          action: 'cleanup',
          tabId: tabId 
        }).catch(() => {
          // Ignore errors if tab is already closed
        });
      }
      
      // Clean up all stored data for this tab
      delete connections[tabId];
      delete messageQueue[tabId];
      delete contentScriptReady[tabId];
      
      console.log(`Cleaned up resources for tab ${tabId}`);
    }
  });
});

// Relay messages from the content script to the DevTools page
chrome.runtime.onMessage.addListener(function(message, sender) {
    if (sender.tab) {
        const tabId = sender.tab.id;
        if (message.type === 'content_script_ready') {
            contentScriptReady[tabId] = true;
            if (messageQueue[tabId]) {
                messageQueue[tabId].forEach(msg => chrome.tabs.sendMessage(tabId, msg));
                delete messageQueue[tabId];
            }
            return;
        }

        const port = connections[tabId];
        if (port) {
            port.postMessage(message);
        }
    }
});