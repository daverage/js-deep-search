/*
    JS Digger
    File: background.js
    Version: 1.2
    
    Copyright © 2018 by Alexander Feinstein
    All Rights Reserved
*/

var tabConnections = {};

chrome.runtime.onConnect.addListener(function (JSDiggerInfo) {  
    var JSDevtools2JSDiggerListener = function (messageData) {
        if (messageData.command) {
            if (messageData.command == "injectJSDiggerContentScript") {
                tabConnections[messageData.tabId] = JSDiggerInfo;
                chrome.tabs.executeScript(messageData.tabId, {file: messageData.message, matchAboutBlank: true}, function (failedIfUndefined) {
                    handleFailure(failedIfUndefined, messageData.tabId);
                });
            } else {
                chrome.tabs.executeScript(messageData.tabId, {code: `
                    try {
                        receiveMessage(` + JSON.stringify(messageData.command) + `, ` + JSON.stringify(messageData.message) + `);
                    } catch (err) {
                        if (err instanceof ReferenceError && window.sendMessageOnce == undefined) {
                            window.sendMessageOnce = true; 
                            chrome.runtime.sendMessage({"command": "restart", "message": "[]", "source": "JSDigger-contentScript", "destination": "JSDigger-devtools"});
                        }
                    }
                `, matchAboutBlank: true}, function (failedIfUndefined) {
                    handleFailure(failedIfUndefined, messageData.tabId);
                });
            }
        }
    }

    JSDiggerInfo.onMessage.addListener(JSDevtools2JSDiggerListener);

    JSDiggerInfo.onDisconnect.addListener(function(JSDiggerInfo) {
        var JSDiggerTabs = Object.keys(tabConnections);
        JSDiggerInfo.onMessage.removeListener(JSDevtools2JSDiggerListener);
        for (var i = 0; i < JSDiggerTabs.length; i++) {
            if (tabConnections[JSDiggerTabs[i]] == JSDiggerInfo) {
                delete tabConnections[JSDiggerTabs[i]]
                break;
            }
        }
    });
});

chrome.runtime.onMessage.addListener(function(request, sender) {
    if (sender.tab && tabConnections[sender.tab.id] != undefined) {
        tabConnections[sender.tab.id].postMessage(request);
    }
});

function handleFailure(failedIfUndefined, tabID) {
    if (failedIfUndefined == undefined) {
        chrome.tabs.query({active: true}, function(tabs) {
            var action = '"handleNullTabId"';
            for (var i = 0; i < tabs.length; i++) {
                if (tabs[i].id == tabID && tabs[i].url.substring(0, 7) == "file://") {
                    action = '"handleFilePermissionRequest"';
                    break;
                }
            }
            tabConnections[tabID].postMessage({"command": "handleTabError", "message": action, "source": "JSDigger-backgroundScript", "destination": "JSDigger-devtools"});
        });
    }
}