/*
    JS Digger
    File: contentScript.js
    Version: 1.2
    
    Copyright © 2018 by Alexander Feinstein
    All Rights Reserved
*/
var PARSERLENGTH = 3000000;
var PARSERIDS = new Set(); 
var BLACK_LISTED_ERROR = "extension context invalidated";

if (!JSDiggerCSListener) {
    var JSDiggerCSListener = true;
    window.addEventListener("message", function(event) {
        var messageData = event.data;
        if (event.source == window && messageData.source == "JSDigger-contentScript" && messageData.destination == "JSDigger-devtools") {
            try {
                chrome.runtime.sendMessage(messageData);
            } catch(err) {
                if (!messageData.isFromMessageParser && err.message.substring(0, BLACK_LISTED_ERROR.length).toLowerCase() != BLACK_LISTED_ERROR) {
                    messageParser(messageData);
                }
            }
        }
    });
}

function injectScriptToWebpage(code) {
    var injectedScript = document.createElement("script");
    injectedScript.id = "JSDiggerChromeExtension";

    injectedScript.innerHTML = code + "document.getElementById('JSDiggerChromeExtension').remove();"; 
    document.body.appendChild(injectedScript);
}

function receiveMessage(command, message) {
    injectScriptToWebpage('JSDiggerChromeExtension.receiveFromDevTools(' + JSON.stringify(command) + ', ' + JSON.stringify(message) + ');'); 
}

function messageParser(fullMessage) {
    if (fullMessage.message.length < PARSERLENGTH) {
        // Check if the message actually needs the message parser to be sent. 
        // If it doesn't, we can assume that the error thrown above was not
        // due to the message's length. If this is the case, do not send the
        // message.
        return;
    }

    var id = 0; 
    while (PARSERIDS.has(id)) {
        id += 1; 
    }
    PARSERIDS.add(id);
    for (var i = 0; i < fullMessage.message.length; i += PARSERLENGTH) {
        try {
            window.postMessage({"command": "deliverSplitMessage", "message": {"message": fullMessage.message.substring(i, i + PARSERLENGTH), "ID": id}, "source": "JSDigger-contentScript", "destination": "JSDigger-devtools", "isFromMessageParser": true},"*");
        } catch (err) {
            return;
        }
    }    
    window.postMessage({"command": "executeSplitMessage", "message": {"message": fullMessage.command, "ID": id}, "source": "JSDigger-contentScript", "destination": "JSDigger-devtools", "isFromMessageParser": true},"*");
    
    PARSERIDS.delete(id)
}

injectScriptToWebpage(`
    if (window.JSDiggerChromeExtension == undefined) {
        var JSDiggerChromeExtension = {
            mainValues: {
                blacklist: {},
                doesTypeofHaveInstanceVars: {"undefined": false, "boolean": false, "number": false, "string": false, "symbol": false, "object": true, "function": true},
                defaultCircularVals: {"window": true},

                newScanInProgress: false, 
                sendingResults: false, 
                canceledScan: false,
                stoppedScan: false,

                transferVal: undefined,
                pingMessage: [1],

                recursionLimitCC: 5,
                maxObjectLimit: 50,
                totalScanCharLimit: 100000000,
                totalValueCharLimit: 2000000,
                scanRoundMin: 500,
                scanTime: 5
            },
            tools: {
                saveDefault: {
                    JSONstringify: JSON.stringify,
                    JSONparse: JSON.parse,
                    eval: eval,
                    consolelog: console.log
                },
                addCommasToNumber: function(num) {
                    num = num+"";
                    var newNum = "";
                    for (var i = num.length; i > 0; i -= 3) {
                        newNum = "," + num.substring(i, i - 3) + newNum;
                    }
                    if (newNum[0] == ",") {
                        newNum = newNum.substring(1, newNum.length);
                    }
                    return newNum;
                },
                isArray: function(val) {
                    var type = this.typeOf(val);
                    return JSDiggerChromeExtension.mainValues.blacklist["Window"][type] == true && typeof val == "object" && this.includesPattern(type, "Array") && !isNaN(val.length);
                },
                includesPattern: function(fullString, pattern) {
                    if (pattern.length == 0 || pattern.length > fullString.length) {
                        return pattern.length == 0;
                    }
                    for (var i = 0; i <= fullString.length - pattern.length; i++) {
                        var fullStringSection = fullString.substring(i, i + pattern.length);
                        if (fullStringSection == pattern) {
                            return true;
                        }
                    }
                    return false; 
                },
                interval: function(func, time) {
                    var timeoutHandler = setTimeout(function tick() {
                        if (!func()) {
                            timeoutHandler = setTimeout(tick, time);
                        }
                    });
                },
                logAllJSDiggerReferences: function(set, JSDiggerObj) {
                    set.add(JSDiggerObj);
                    var val;
                    if (JSDiggerObj != this.saveDefault) {
                        for (var name in JSDiggerObj) {
                            if (JSDiggerObj.hasOwnProperty(name)) {
                                val = JSDiggerObj[name];
                                if (typeof val == "object") {
                                    this.logAllJSDiggerReferences(set, val);
                                } else if (typeof val == "function") {
                                    set.add(val);
                                }
                            }
                        }
                    }
                },
                storeFinalName: function(name, key) {
                    if (this.hasNonVarChars(key)) {
                        name = name || "window"; 
                        return name + "[" + this.saveDefault.JSONstringify(key) + "]";
                    } else if (isNaN(key) == false) {
                        name = name || "window"; 
                        return name + "[" + key + "]";
                    } else {
                        if (name.length) {
                            name += ".";
                        }
                        return name + key;
                    }
                },
                storeFinalVal: function(val, isCircular) {
                    if (this.isTypeWithInstanceVars(val)) {
                        if (isCircular || this.isValChangedBySend(val)) {
                            return this.stringValue(val);
                        } else if (this.objHasKeys(val)) {
                            return this.stringValue(val, true);
                        } else {
                            return this.saveDefault.JSONparse(this.saveDefault.JSONstringify(val));
                        }
                    } else if (this.isValChangedBySend(val)) {
                        return this.stringValue(val);
                    } else {
                        return val;
                    }
                },
                objHasKeys: function(obj) {
                    if (this.countObjKeys(obj, 0) == -1) {
                        return true;
                    }
                    return this.getObjectKeys(obj).length > 0;
                },
                countObjKeys: function(obj, limit) {
                    if (this.isArray(obj) && obj.length > limit) {
                        return -1;
                    }
                    var count = 0;
                    for (var key in obj) {
                        if (obj.hasOwnProperty(key)) {
                            count += 1;
                            if (count > limit) {
                                return -1;
                            }
                        }
                    }
                    return count;
                },
                hasNonVarChars: function(name) {
                    if (name.length == 0) {
                        return true;
                    }
                    for (var i = 0; i < name.length; i++) {
                        if (/[A-Z]|[a-z]|[0-9]|\\\_|\\\$/.test(name[i]) == false) {
                            return true;
                        }
                    }
                    return false; 
                },
                countChildren: function(objectVal, currentCount, recursionsIn) {
                    var newResult = 1;
                    if (recursionsIn > JSDiggerChromeExtension.mainValues.recursionLimitCC || currentCount > JSDiggerChromeExtension.mainValues.maxObjectLimit) {
                        throw new RangeError();
                    }
                    if (this.isTypeWithInstanceVars(objectVal) && objectVal != null) {
                        if (this.countObjKeys(objectVal, JSDiggerChromeExtension.mainValues.maxObjectLimit - currentCount) == -1) {
                            throw new RangeError();
                        }
                        var keys = [];
                        try {
                            keys = Object.getOwnPropertyNames(objectVal);
                        } catch(err) {
                            try {
                                keys = Object.keys(objectVal);
                            } catch(err) {}
                        }
                        for (var i = 0; i < keys.length; i++) {
                            var objKeyVal;
                            try {
                                objKeyVal = objectVal[keys[i]];
                            } catch(err) {
                                continue;
                            }
                            newResult += JSDiggerChromeExtension.tools.countChildren(objKeyVal, currentCount + keys.length + newResult - i, recursionsIn + 1);
                        };
                    }
                    return newResult;
                },
                isTypeWithInstanceVars: function(val) {
                    var type = typeof val;
                    return JSDiggerChromeExtension.mainValues.doesTypeofHaveInstanceVars[type] == true;
                },
                isValChangedBySend: function(val) {
                    return this.saveDefault.JSONstringify(val) == undefined;
                },
                detectCircularObject: function(objectVal) {
                    try {
                        JSDiggerChromeExtension.tools.countChildren(objectVal, 0, 0);
                        return false; 
                    } catch(err) {
                        return true; 
                    }
                },
                typeOf: function(varVal) {
                    try {
                        var typeShell = Object.prototype.toString.call(varVal).split(" ")[1];
                        return typeShell.substring(0, typeShell.length - 1);
                    } catch(err) {
                        return (typeof varVal)[0].toUpperCase() + (typeof varVal).substring(1); 
                    }
                },
                stringValue: function(val, stringify) {
                    var returnVal = "";
                    try {
                        if (stringify) {
                            returnVal = this.saveDefault.JSONstringify(val);
                        } else if (typeof val == "object") {
                            if (this.isArray(val)) {
                                returnVal = this.stringTypeValue(val);
                            } else {
                                returnVal = Object.prototype.toString.call(val);
                            }
                        } else {
                            returnVal = val.toString();
                        }
                    } catch (err) {
                        returnVal = this.makeUpStringValue(val);
                    }
                    if (typeof returnVal != "string" || (returnVal == "" && typeof val != "string")) {
                        returnVal = this.makeUpStringValue(val);
                    }
                    if (returnVal.length > JSDiggerChromeExtension.mainValues.totalValueCharLimit) {
                        returnVal = this.stringTypeValue(val, returnVal);
                    }
                    return returnVal;
                },
                makeUpStringValue: function(val) {
                    var returnVal = ""; 
                    if (val == null) {
                        returnVal = val+"";
                    }
                    if (returnVal == "") {
                        returnVal = this.stringTypeValue(val);
                    }
                    return returnVal;
                },
                stringTypeValue: function(val, tooLongString) {
                    if (this.isArray(val)) {
                        return this.typeOf(val) + "(" + val.length + ")";
                    } else if (tooLongString) {
                        return "[" + this.typeOf(val) + " (" + this.addCommasToNumber(tooLongString.length) + " chars)]";
                    } else {
                        return "[" + this.typeOf(val) + " contents unavailable]";
                    }
                },
                isWindowObject: function(varVal) {
                    if (this.stringValue(varVal) != "[object Window]") {
                        return "everything";
                    } else {
                        return "Window";
                    }
                },
                editVariable: function(objName, action, changeVal) { 
                    var errorMessage = "";
                    var varKeyword = "";
                    var oldChangeVal;
                    JSDiggerChromeExtension.mainValues.transferVal = undefined;

                    if (action == 3) {
                        try {
                            changeVal = this.saveDefault.JSONparse(changeVal);
                            action = 2;
                        } catch(err) {

                        }
                    }
                        
                    try {
                        JSDiggerChromeExtension.tools.saveDefault.eval("JSDiggerChromeExtension.mainValues.transferVal = " + objName + ";"); 
                        if (JSDiggerChromeExtension.ownValues.has(JSDiggerChromeExtension.mainValues.transferVal)) {
                            errorMessage = "THAT'S JS DIGGER'S CODE!";
                            JSDiggerChromeExtension.mainValues.transferVal = undefined;
                            action = 0; 
                        }
                    } catch(err) {
                        if (action >= 2) {
                            varKeyword = "var ";
                        } else {
                            errorMessage = err.message;
                            action = 0;
                        }
                    }

                    if (action >= 2) {
                        try {      
                            oldChangeVal = JSDiggerChromeExtension.mainValues.transferVal;
                            JSDiggerChromeExtension.mainValues.transferVal = changeVal;
                            
                            if (action == 3) {
                                JSDiggerChromeExtension.tools.saveDefault.eval("JSDiggerChromeExtension.mainValues.transferVal = " + JSDiggerChromeExtension.mainValues.transferVal);
                            }

                            if (JSDiggerChromeExtension.ownValues.has(JSDiggerChromeExtension.mainValues.transferVal)) {
                                errorMessage = "THAT'S JS DIGGER'S CODE!";  
                                JSDiggerChromeExtension.mainValues.transferVal = oldChangeVal;
                            } else {
                                JSDiggerChromeExtension.tools.saveDefault.eval(varKeyword + objName + " = JSDiggerChromeExtension.mainValues.transferVal; JSDiggerChromeExtension.mainValues.transferVal = " + objName + ";");
                            }
                        } catch(err) {
                            errorMessage = err.message; 
                            JSDiggerChromeExtension.mainValues.transferVal = oldChangeVal;
                        }
                    } else if (action == 1) {
                        try {
                            JSDiggerChromeExtension.tools.saveDefault.eval("if (!(delete " + objName + ")) {" + objName + " = undefined;}");
                            JSDiggerChromeExtension.mainValues.transferVal = undefined; 
                        } catch(err) {
                            errorMessage = err.message;
                        }
                    }
                
                    unalteredByCircleObjValue = JSDiggerChromeExtension.mainValues.transferVal; 
                    JSDiggerChromeExtension.mainValues.transferVal = undefined;
                    return [this.storeFinalVal(unalteredByCircleObjValue, this.detectCircularObject(unalteredByCircleObjValue)), errorMessage, unalteredByCircleObjValue];
                },
                getObjectKeys: function(obj) {
                    if (this.isTypeWithInstanceVars(obj)) {
                        try {
                            return Object.getOwnPropertyNames(obj);
                        } catch(err) {
                            try {
                                return Object.keys(obj);
                            } catch(err) {}
                        };
                    }
                    return [];
                }
            },
            receiveFromDevTools: function(command, message) {
                this.activateCommand[command](message);
            },
            sendToDevTools: function(command, message) {
                window.postMessage({"command": command, "message": JSDiggerChromeExtension.tools.saveDefault.JSONstringify(message), "source": "JSDigger-contentScript", "destination": "JSDigger-devtools", "isFromMessageParser": false},"*");
            },
            startUp: function() {
                delete window.sendMessageOnce;
                if (JSDiggerChromeExtension.ownValues == undefined) {
                    JSDiggerChromeExtension.ownValues = new Set();
                    JSDiggerChromeExtension.tools.logAllJSDiggerReferences(JSDiggerChromeExtension.ownValues, JSDiggerChromeExtension);
                }

                JSDiggerChromeExtension.mainValues.pingMessage = [1];
                JSDiggerChromeExtension.sendToDevTools("ping", JSDiggerChromeExtension.mainValues.pingMessage);
                JSDiggerChromeExtension.mainValues.pingMessage = [0];
            },
            activateCommand: {
                "beginNewScan": function(message) {
                    if (JSDiggerChromeExtension.mainValues.newScanInProgress == false) {
                        JSDiggerChromeExtension.mainValues.newScanInProgress = true; 
                        var tempVarNames = [""];
                        var tempVarVals = [window];
                        var tempVarTypes = [JSDiggerChromeExtension.tools.typeOf(window)];
                        var finalVarNames = []; 
                        var finalVarVals = []; 
                        var finalVarTypes = [];
                        var getKeys = [];
                        
                        var scanLimit = 0;
                        var holdCyclePlace = 0; 
                        var TVNIndex = 0; 
                        var GKIndex = 0;
                        var charLength = 0;
                        var roundKeys = 0;

                        var recordCircularValues = new Set();
                        for (var name in JSDiggerChromeExtension.mainValues.defaultCircularVals) {
                            if (JSDiggerChromeExtension.mainValues.defaultCircularVals.hasOwnProperty(name)) {
                                recordCircularValues.add(window[name]);
                            }
                        }

                        var getName;
                        var getVal;
                        var finalVal;
                        var getType;

                        if (message) {
                            JSDiggerChromeExtension.mainValues.blacklist = message; 
                        }
                        JSDiggerChromeExtension.tools.interval(function() {
                            roundKeys = 0; 
                            while (roundKeys < JSDiggerChromeExtension.mainValues.scanRoundMin) {                                
                                if (GKIndex >= getKeys.length) {
                                    getKeys = JSDiggerChromeExtension.tools.getObjectKeys(tempVarVals[TVNIndex]);
                                    GKIndex = 0;
                                }
                                for (;GKIndex < getKeys.length && roundKeys < JSDiggerChromeExtension.mainValues.scanRoundMin; GKIndex++) {
                                    try {
                                        var isWindow = JSDiggerChromeExtension.tools.isWindowObject(tempVarVals[TVNIndex]); 
                                        if (JSDiggerChromeExtension.mainValues.blacklist[isWindow][getKeys[GKIndex]] == true) {
                                            continue;
                                        }

                                        getName = JSDiggerChromeExtension.tools.storeFinalName(tempVarNames[TVNIndex], getKeys[GKIndex]); 
                                        getVal = tempVarVals[TVNIndex][getKeys[GKIndex]];
                                        getType = JSDiggerChromeExtension.tools.typeOf(getVal);

                                        var isCircular = JSDiggerChromeExtension.tools.detectCircularObject(getVal); 
                                        if (isCircular) {
                                            if (recordCircularValues.has(getVal)) {
                                                getVal = JSDiggerChromeExtension.tools.stringValue(getVal);
                                            } else {
                                                recordCircularValues.add(getVal);
                                            }
                                        }

                                        finalVal = JSDiggerChromeExtension.tools.storeFinalVal(getVal, isCircular);
                                        charLength += JSDiggerChromeExtension.tools.saveDefault.JSONstringify(getName).length + JSDiggerChromeExtension.tools.saveDefault.JSONstringify(finalVal).length + JSDiggerChromeExtension.tools.saveDefault.JSONstringify(getType).length + 3;
                                        if (charLength > JSDiggerChromeExtension.mainValues.totalScanCharLimit) {
                                            GKIndex = getKeys.length;
                                            break;
                                        }

                                        if (JSDiggerChromeExtension.tools.isTypeWithInstanceVars(getVal)) {
                                            tempVarNames.push(getName);
                                            tempVarVals.push(getVal);
                                            tempVarTypes.push(getType);
                                        }

                                        finalVarNames.push(getName);
                                        finalVarVals.push(finalVal); 
                                        finalVarTypes.push(getType);
                                        roundKeys += 1;
                                    } catch(err) {}
                                }

                                if (GKIndex == getKeys.length) {
                                    delete tempVarNames[TVNIndex];
                                    delete tempVarVals[TVNIndex];
                                    delete tempVarTypes[TVNIndex];

                                    if (holdCyclePlace == TVNIndex) {
                                        scanLimit += 1; 
                                        holdCyclePlace = tempVarNames.length - 1;
                                    }
                                    TVNIndex += 1;
                                }

                                if (tempVarNames.length == TVNIndex || JSDiggerChromeExtension.mainValues.stoppedScan || charLength > JSDiggerChromeExtension.mainValues.totalScanCharLimit) {
                                    if (JSDiggerChromeExtension.mainValues.stoppedScan == false) {
                                        scanLimit = Number.MAX_SAFE_INTEGER;
                                    }
                                    if (JSDiggerChromeExtension.mainValues.sendingResults == false) {
                                        JSDiggerChromeExtension.mainValues.sendingResults = true;

                                        JSDiggerChromeExtension.sendToDevTools("ping", [2, finalVarNames.length, 100]);
                                        JSDiggerChromeExtension.sendToDevTools("newVarSet", [finalVarNames, finalVarVals, finalVarTypes, scanLimit]);

                                        JSDiggerChromeExtension.mainValues.newScanInProgress = false; 
                                        JSDiggerChromeExtension.mainValues.stoppedScan = false;
                                        JSDiggerChromeExtension.mainValues.sendingResults = false;
                                    }
                                    return true;
                                } else if (JSDiggerChromeExtension.mainValues.canceledScan) {
                                    JSDiggerChromeExtension.sendToDevTools("cancelAcknowledge", 0);
                                    JSDiggerChromeExtension.mainValues.newScanInProgress = false; 
                                    JSDiggerChromeExtension.mainValues.stoppedScan = false;
                                    JSDiggerChromeExtension.mainValues.canceledScan = false; 
                                    return true;
                                }
                            }
                            JSDiggerChromeExtension.sendToDevTools("ping", [2, finalVarNames.length, Math.max(Math.floor((TVNIndex / tempVarNames.length) * 100), Math.floor((charLength / JSDiggerChromeExtension.mainValues.totalScanCharLimit) * 100)), scanLimit]);
                        }, JSDiggerChromeExtension.mainValues.scanTime);
                    }
                },
                "cancelScan": function() {
                    JSDiggerChromeExtension.mainValues.canceledScan = true;
                },
                "stopScan": function() {
                    JSDiggerChromeExtension.mainValues.stoppedScan = true; 
                },
                "findNewObjectKeys": function(message) {
                    var regularObjectName = message[0];
                    var regularOldObjectName = message[1]; 
                    var newMessage = message[2];
                    var scanLimit = message[3];
                    var cyclesLeft = message[3] - message[4];
                    var charLength = message[5];
                    var originalNameData = message[6];

                    while (cyclesLeft <= 0) {
                        scanLimit += 1;    
                        cyclesLeft += 1; 
                    }

                    var objectInfo = JSDiggerChromeExtension.tools.editVariable(regularObjectName); 
                    var startType = JSDiggerChromeExtension.tools.typeOf(objectInfo[2]);

                    if (JSDiggerChromeExtension.tools.isWindowObject(objectInfo[2]) == "Window") {
                        objectInfo[2] = objectInfo[0];
                    }

                    var tempVarNames = [regularObjectName];
                    var tempVarVals = [objectInfo[2]];
                    var tempVarTypes = [startType];
                    var finalVarNames = [regularObjectName];
                    var finalVarVals = [JSDiggerChromeExtension.tools.storeFinalVal(objectInfo[2], JSDiggerChromeExtension.tools.detectCircularObject(objectInfo[2]))]; 
                    var finalVarTypes = [startType]; 
                    var getKeys = [];

                    var recordCircularValues = new Set();
                    for (var name in JSDiggerChromeExtension.mainValues.defaultCircularVals) {
                        if (JSDiggerChromeExtension.mainValues.defaultCircularVals.hasOwnProperty(name)) {
                            recordCircularValues.add(window[name]);
                        }
                    }

                    var holdCyclePlace = 0;
                    var TVNIndex = 0;
                    var GKIndex = 0;
                    var roundKeys = 0;

                    var getName;
                    var getVal;
                    var finalVal;
                    var getType;                    

                    charLength += JSDiggerChromeExtension.tools.saveDefault.JSONstringify(finalVarNames[TVNIndex]).length + JSDiggerChromeExtension.tools.saveDefault.JSONstringify(finalVarVals[TVNIndex]).length + JSDiggerChromeExtension.tools.saveDefault.JSONstringify(finalVarTypes[TVNIndex]).length + 3; 

                    JSDiggerChromeExtension.tools.interval(function() {
                        roundKeys = 0; 
                        while (roundKeys < JSDiggerChromeExtension.mainValues.scanRoundMin) {
                            if (GKIndex >= getKeys.length) {
                                getKeys = JSDiggerChromeExtension.tools.getObjectKeys(tempVarVals[TVNIndex]);
                                GKIndex = 0;
                            }
                            for (;GKIndex < getKeys.length && roundKeys < JSDiggerChromeExtension.mainValues.scanRoundMin; GKIndex++) {
                                try {
                                    var isWindow = JSDiggerChromeExtension.tools.isWindowObject(tempVarVals[TVNIndex]); 
                                    if (JSDiggerChromeExtension.mainValues.blacklist[isWindow][getKeys[GKIndex]] == true) {
                                        continue;
                                    }

                                    getName = JSDiggerChromeExtension.tools.storeFinalName(tempVarNames[TVNIndex], getKeys[GKIndex]);
                                    getVal = tempVarVals[TVNIndex][getKeys[GKIndex]];
                                    getType = JSDiggerChromeExtension.tools.typeOf(getVal);

                                    var isCircular = JSDiggerChromeExtension.tools.detectCircularObject(getVal); 
                                    if (isCircular) {
                                        if (recordCircularValues.has(getVal)) {
                                            getVal = JSDiggerChromeExtension.tools.stringValue(getVal);
                                        } else {
                                            recordCircularValues.add(getVal);
                                        }
                                    }

                                    finalVal = JSDiggerChromeExtension.tools.storeFinalVal(getVal, isCircular);
                                    charLength += JSDiggerChromeExtension.tools.saveDefault.JSONstringify(getName).length + JSDiggerChromeExtension.tools.saveDefault.JSONstringify(finalVal).length + JSDiggerChromeExtension.tools.saveDefault.JSONstringify(getType).length + 3;
                                    if (charLength > JSDiggerChromeExtension.mainValues.totalScanCharLimit) {
                                        GKIndex = getKeys.length;
                                        break;
                                    }

                                    if (JSDiggerChromeExtension.tools.isTypeWithInstanceVars(getVal)) {
                                        tempVarNames.push(getName);
                                        tempVarVals.push(getVal);
                                        tempVarTypes.push(getType);
                                    }

                                    finalVarNames.push(getName);
                                    finalVarVals.push(finalVal); 
                                    finalVarTypes.push(getType);
                                    roundKeys += 1;
                                } catch(err) {}
                            }

                            if (GKIndex == getKeys.length) {
                                delete tempVarNames[TVNIndex];
                                delete tempVarVals[TVNIndex];
                                delete tempVarTypes[TVNIndex];

                                if (holdCyclePlace == TVNIndex) {
                                    cyclesLeft--; 
                                    holdCyclePlace = tempVarNames.length - 1;
                                }
                                TVNIndex += 1;
                            }

                            if (tempVarNames.length == TVNIndex || cyclesLeft <= 0 || charLength > JSDiggerChromeExtension.mainValues.totalScanCharLimit) {
                                JSDiggerChromeExtension.sendToDevTools("returnFromFNOK", [finalVarNames, finalVarVals, finalVarTypes, regularObjectName, regularOldObjectName, newMessage, scanLimit, originalNameData]);
                                return true;
                            }
                        }
                    }, JSDiggerChromeExtension.mainValues.scanTime);   
                },
                "refreshOneVar": function(message) {
                    try {
                        var getVal = JSDiggerChromeExtension.tools.editVariable(message[0]);
                        var returnMessage = "";
                        var status = (getVal[1] == "") * 1; 
                        if (status) {
                            returnMessage = "VALUE REFRESHED";
                            if (message[1] == 1) {
                                JSDiggerChromeExtension.tools.saveDefault.consolelog(message[0] + " :", getVal[2]);
                                returnMessage = "VALUE SENT TO CONSOLE";
                            } else if (message[1] == 2) {
                                returnMessage = "GET OBJECT PROPS";
                            }
                        } else {
                            returnMessage = getVal[1];    
                        }
                        JSDiggerChromeExtension.sendToDevTools("oneNewVar", [message[0], message[0], getVal[0], [status, returnMessage], message[2]]);
                    } catch(err) {
                        JSDiggerChromeExtension.sendToDevTools("disableWaitingPrompt", 0);
                    }
                },
                "updateVar": function(message) {
                    try {
                        var newVarName = message[0];
                        var oldVarName = message[2];
                        var newVarAction = 3; 
                        try {
                            if (message[3]) {
                                throw new Error();
                            }
                            message[1] = JSDiggerChromeExtension.tools.saveDefault.JSONparse(message[1]);
                            newVarAction = 2; 
                        } catch(err) {
                            var oldVarCurrInfo = JSDiggerChromeExtension.tools.editVariable(oldVarName);
                            if (oldVarCurrInfo[1] == "" && (oldVarCurrInfo[0] == message[1] || message[3])) {
                                message[1] = oldVarCurrInfo[2];
                                newVarAction = 2;
                            }
                        }

                        var getVal = JSDiggerChromeExtension.tools.editVariable(newVarName, newVarAction, message[1]);
                        if (getVal[1] == "") {
                            JSDiggerChromeExtension.tools.editVariable(oldVarName, 1);
                            getVal = JSDiggerChromeExtension.tools.editVariable(newVarName, newVarAction, message[1]);
                        }
                        if (getVal[1] == "") {
                            JSDiggerChromeExtension.sendToDevTools("oneNewVar", [newVarName, oldVarName, getVal[0], [1, "VALUE UPDATED"]]);
                        } else {
                            var oldOldVarName = oldVarName; 
                            if (message[3]) {
                                oldOldVarName = "";
                            }
                            var getOldVal = JSDiggerChromeExtension.tools.editVariable(oldVarName);
                            JSDiggerChromeExtension.sendToDevTools("oneNewVar", [oldVarName, oldOldVarName, getOldVal[0], [0, getVal[1]]]);
                        }
                    } catch(err) {
                        JSDiggerChromeExtension.sendToDevTools("disableWaitingPrompt", 0);
                    }
                },
                "ping": function() {
                    JSDiggerChromeExtension.sendToDevTools("ping", JSDiggerChromeExtension.mainValues.pingMessage);
                }
            }
        } 
    }
    JSDiggerChromeExtension.startUp();
`);