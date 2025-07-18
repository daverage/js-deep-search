/*
    JS Digger
    File: initiateJSDevtools.js
    Version: 1.2
    
    Copyright © 2018 by Alexander Feinstein
    All Rights Reserved
*/

var documentElement;
var backgroundPageConnection; 

var activatedAlready = false;
var panelIsBeingViewed = false; 
var restartActivated = false;

chrome.devtools.panels.create("JS Digger",
	"128logo.png",
    "JSDevtools.html",
    function(panel) {
        panel.onShown.addListener(function(event) {
            documentElement = event.document;
            panelIsBeingViewed = true;
            if (activatedAlready == false) { 
                activatedAlready = true;
                startUp(event);
            } else if (restartActivated) {
                JSDevtools.receiveFromContent("restart", "[]");
            }
        });
    
        panel.onHidden.addListener(function(event) {
            panelIsBeingViewed = false; 
        });
    }
);

function startUp(event) {
    try {
        backgroundPageConnection = chrome.runtime.connect({
            name: "JSDigger-devtools"
        });
    } catch(err) {
        JSDevtools.failedTabScreens.handleExtensionReload();
    } 

    backgroundPageConnection.onMessage.addListener(function(messageData) {
        JSDevtools.receiveFromContent(messageData.command, messageData.message);
    });

    JSDevtools.startUp();
}

var JSDevtools = {};

JSDevtools.arrowPhotos = ["Images/ArrowButtonLeft.png","Images/ArrowButtonRight.png","Images/ArrowButtonLeftClicked.png","Images/ArrowButtonRightClicked.png"];

JSDevtools.mainValues = {
    nameArray: [],
    valueArray: [],
    typeArray: [],
    displayPlaces: [],
    scanLimit: 0,
    
    sectorDisplay: 0,
    totalSectors: 0,
    totalTabs: 0,
    newTotalTabs: 30,
    maxTotalTabs: 200,
    tabHTML: '<div class="varBarItem varBarItemName"><textarea class="promptMessage" readonly></textarea><textarea class="varBox"></textarea></div><div class="varBarItem varBarItemValue"><textarea class="promptMessage" readonly></textarea><textarea class="varBox"></textarea></div><div class="varBarItem varBarItemType"><textarea class="varBox typeBox" readonly></textarea></div><div class="varBarItem varBarButtons"><div title="View Methods and Properties" class="varItemButton varButtonObject"><img src="Images/revealIcon.png"></div><div title="Refresh" class="varItemButton varButtonLeft"><img src="Images/RefreshIcon.png"></div><div title="Send to Console" class="varItemButton varButtonRight"><img src="Images/ConsoleIcon.png"></div></div>',
    
    organizeBy: 0,
    changedCaseSensitivity: [0, 0, 0],
    savedCaseSensitivity: [0, 0, 0],
    caseSensitivityFont: [100, 900, 900],
    caseSensitivityImg: ["Images/caseInsensitive.png", "Images/caseSensitive.png", "Images/caseExact.png"],
    caseSensitivityTitles: ["Case insensitive (click to cycle)", "Case sensitive (click to cycle)", "Exact match (click to cycle)"],
    caseSensitivityText: ["[CASE INSENSITIVE]", "[CASE SENSITIVE]", "[EXACT MATCH]"],
    
    
    searchTerms: ["","","","", true],
    searchButtomImg: ["Images/search.png", "Images/back.png"],
    sortArray: [],

    NASearch: new Set(),
    
    DATriggers: {},
    scanPromptShownBefore: false,
    firstScanStarted: false,
    
    lastActiveBox: null, 
    lastActiveSearchBox: null, 
    
    commandQueue: [[],[]],
    parsedMessages: {},
    pingInterval: undefined,
    pingReceived: false,
    commandRunning: false,
    inFailState: false,
    
    scriptedMessage: ["VALUE SENT TO CONSOLE", "GET OBJECT PROPS"],
    messageAdditions: ["\n(CLICK TO HIDE MESSAGE)", "\n(SCOPE CHANGED TO VIEW VALUE)", "\n(QUERY CHANGED TO VIEW VALUE)"],
    messageAdditionIndex: 0,
    queryCategories: ["NAME", "VALUE", "TYPE"],

    parseCommandsBlacklist: {"deliverSplitMessage": true, "executeSplitMessage": true},
    endingChars: {"[": true, ".": true},
    functionBoxTypes: {"Function": true},
    typesWithNoChildren: {"Window": true, "Undefined": true, "Null": true, "Symbol": true},
    doesTypeofHaveInstanceVars: {"undefined": false, "function": false, "object": false, "boolean": false, "number": false, "symbol": false, "string": true},
    
    queryMaxLength: 47,
    warningTriggerLimit: 500000,
    totalValueCharLimit: 2000000,
}

JSDevtools.tools = {
    interval: function(func, time) {
        var timeoutHandler = setTimeout(function tick() {
            if (!func()) {
                timeoutHandler = setTimeout(tick, time);
            }
        });
    },
    drawAttention: function(elem, className, DAClass) {
        var trigger = elem.id || elem.className;
        elem.className = className + " " + DAClass;
        
        if (JSDevtools.mainValues.DATriggers[trigger] == undefined || isNaN(JSDevtools.mainValues.DATriggers[trigger])) {
            JSDevtools.mainValues.DATriggers[trigger] = 1;
        } else {
            JSDevtools.mainValues.DATriggers[trigger] += 1; 
        }
        
        setTimeout(function() {
            if (JSDevtools.mainValues.DATriggers[trigger] == 1) {
                elem.className = className;
            }
            JSDevtools.mainValues.DATriggers[trigger] -= 1; 
        }, 475);
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
    horizontalScrolling: function(event) {
        if (this.className == "varBox functionBox" || (this.id != "navigationWrapper" && documentElement.activeElement != this)) {return}
        if (event.deltaY != 0) {
            this.scroll(this.scrollLeft + event.deltaY, this.scrollTop);
            event.preventDefault();
        }
    },
    isTypeWithInstanceVars: function(val) {
        var type = typeof val;
        return JSDevtools.mainValues.doesTypeofHaveInstanceVars[type] == true;
    },
    isEndingChar: function(char) {
        return JSDevtools.mainValues.endingChars[char+""] == true;
    },
    resetNASearch: function() {
        JSDevtools.mainValues.NASearch.clear();
        for (var i = 0; i < JSDevtools.mainValues.nameArray.length; i++) {
            JSDevtools.mainValues.NASearch.add(JSDevtools.mainValues.nameArray[i]);
        }
    },
    getScanLimit: function(name) {
        name = this.removeWindow(name);
        var scanLimit = 0; 
        if (name == "window") {
            return 0;
        }
        while (name.length) {
            name = JSDevtools.viewParentObject(name, false);
            scanLimit++;
        }
        return scanLimit; 
    },
    OSAIndexOf: function(arr, searchTerm) {
        for (var i = 0; i < JSDevtools.mainValues.displayPlaces.length; i++) {
            if (arr[JSDevtools.mainValues.displayPlaces[i]] == searchTerm) {
                return i;
            }
        }
        return -1;
    },
    NAIncludes: function(searchTerm) {
        return JSDevtools.mainValues.NASearch.has(searchTerm);
    },
    includesPattern: function(fullString, pattern, caseInsensitivity) {
        if (pattern.length == 0 || pattern.length > fullString.length) {
            return pattern.length == 0;
        }
        if (caseInsensitivity) {
            fullString = fullString.toLowerCase();
            pattern = pattern.toLowerCase();
        }
        for (var i = 0; i <= fullString.length - pattern.length; i++) {
            var fullStringSection = fullString.substring(i, i + pattern.length);
            if (fullStringSection == pattern) {
                return true;
            }
        }
        return false; 
    },
    generateScanLimitText: function(scanLimit) {
        if (scanLimit == 0) {
            return "Window Object";
        } else {
            return "window" + ".".repeat(scanLimit) + "object (x" + scanLimit + " deep)";
        }
    },
    isAllWhiteSpace: function(text) {
        return !(/[^\s]/.test(text));
    },
    removeNewLines: function(val) {
        return val.replace(/\n/g, " ");
    },
    createHashMap: function(arr) {
        var hm = {}; 
        if (arr == undefined) {return hm};
        for (var i = 0; i < arr.length; i++) {
            if (typeof arr[i] == "object") {
                for (var j = 0; j < arr[i].length; j++) {
                    hm[arr[i][j]] = true;
                }
            } else {
                hm[arr[i]] = true; 
            }
        }
        return hm; 
    },
    createNewVarBar: function() {
        var tabElement = documentElement.createElement("div");
            tabElement.className = "varBar";
            tabElement.innerHTML = JSDevtools.mainValues.tabHTML;
        return tabElement;
    },
    activateNewVarBar: function(varBarIndex) {
        var varBar = documentElement.getElementsByClassName("varBar")[varBarIndex]; 
        var promptMessages = varBar.getElementsByClassName("promptMessage");
        var objectButtons = varBar.getElementsByClassName("varButtonObject")[0];
        var varBox = varBar.getElementsByClassName("varBox"); 

        varBar.getElementsByClassName("varButtonLeft")[0].addEventListener("click", function() {
            JSDevtools.refreshOneVar(this, 0); 
        });
        varBar.getElementsByClassName("varButtonRight")[0].addEventListener("click", function() {
            JSDevtools.refreshOneVar(this, 1); 
        });
        objectButtons.addEventListener("click", function() {
            JSDevtools.viewObjectMethods(this); 
        });
        
        for (var j = 0; j < promptMessages.length; j++) {
            promptMessages[j].addEventListener("click", function() {
                JSDevtools.closeMessage(this); 
            });
            promptMessages[j].addEventListener("focus", function() {
                this.blur();
            });
            varBox[j].setAttribute("spellcheck", false);
            varBox[j].setAttribute("autocorrect", "off");
            varBox[j].setAttribute("autocapitalize", "off");
            varBox[j].setAttribute("maxlength", JSDevtools.mainValues.totalValueCharLimit);
            varBox[j].addEventListener("wheel", JSDevtools.tools.horizontalScrolling);
            varBox[j].addEventListener("keydown", function(event) {
                JSDevtools.updateVar(event, this);
            });
            
            varBox[j].addEventListener("focus", function() {
                JSDevtools.restoreValueOfVarBox(JSDevtools.mainValues.lastActiveBox, this);
                JSDevtools.mainValues.lastActiveBox = this; 
                JSDevtools.closeOpenMessage();
            });
        }
    },
    isArray: function(val) {
        var type = this.typeOf(val);
        return JSDevtools.mainValues.blacklist["Window"][type] == true && typeof val == "object" && this.includesPattern(type, "Array") && !isNaN(val.length);
    },
    typeOf: function(varVal) {
        try {
            var typeShell = Object.prototype.toString.call(varVal).split(" ")[1];
            return typeShell.substring(0, typeShell.length - 1);
        } catch(err) {
            return (typeof varVal)[0].toUpperCase() + (typeof varVal).substring(1); 
        }
    },
    mergesort: function(arr, balancer, compare) {
        var middleIndex = Math.floor(arr.length / 2);
        var arr1 = arr.slice(0, middleIndex);
        var arr2 = arr.slice(middleIndex, arr.length);
        var sortedArr = [];

        if (arr1.length > 1) {
            arr1 = this.mergesort(arr1, !balancer, compare);
        }

        if (arr2.length > 1) {
            arr2 = this.mergesort(arr2, !balancer, compare);
        }

        while (arr1.length && arr2.length) {
            if (compare(arr1[arr1.length - 1], arr2[arr2.length - 1]) == balancer) {
                sortedArr.push(arr1.pop());
            } else {
                sortedArr.push(arr2.pop());
            }
        }

        if (arr2.length) {
            while (arr2.length) {
                sortedArr.push(arr2.pop());
            }
        } else {
            while (arr1.length) {
                sortedArr.push(arr1.pop());
            }
        }
        arr2 = arr1 = null;
        return sortedArr;
    },
    compareSortedValues: function(place1, place2, Name0Val1Type2, breakTieUseNA) {
        var firstValue; 
        var secondValue;
        if (breakTieUseNA) {
            firstValue = JSDevtools.mainValues.nameArray[place1].toLowerCase();
            secondValue = JSDevtools.mainValues.nameArray[place2].toLowerCase();
        } else {
            firstValue = JSDevtools.mainValues.sortArray[place1];
            secondValue = JSDevtools.mainValues.sortArray[place2];
            var FVIsNum = typeof firstValue != "number"; 
            var SVIsNum = typeof secondValue != "number";
            
            if (Name0Val1Type2 == 0) {
                firstValue = firstValue.toLowerCase();
                secondValue = secondValue.toLowerCase();
            } else if (FVIsNum != SVIsNum) {
                firstValue = FVIsNum * 1;
                secondValue = SVIsNum * 1;
            } else if (FVIsNum) {
                firstValue = JSDevtools.tools.stringValue(firstValue).toLowerCase();
                secondValue = JSDevtools.tools.stringValue(secondValue).toLowerCase();
            }
        }
        var compareResult = this.numericCompare(firstValue, secondValue);
        if (compareResult == 1) {
            return true;
        } else if (compareResult == -1) {
            return false;
        } else if (!breakTieUseNA) {
            return this.compareSortedValues(place1, place2, Name0Val1Type2, true);
        }
        return false;
    },
    numericCompareGetEndIndex: function(strn) {
        var index = strn.match(/[^0-9]/);
        if (index == null) {
            return strn.length;
        } else {
            return index.index || 1;
        }
    },
    numericCompare: function(s1, s2) {
        var s1len = s1.length;
        var s2len = s2.length;
        var result;
        while (s1.length && s2.length) {
            var endI1 = this.numericCompareGetEndIndex(s1);
            var endI2 = this.numericCompareGetEndIndex(s2);
            p1 = s1.substring(0, endI1);
            p2 = s2.substring(0, endI2);
            if (isNaN(p1) == false && isNaN(p2) == false) {
                p1 = +p1;
                p2 = +p2; 
            }
            if (p1 != p2) {
                result = p1 < p2;
                return (result + result - 1);
            }
            s1 = s1.substring(endI1, s1.length);
            s2 = s2.substring(endI2, s2.length);
        }
        if (s1len == s2len) {
            return 0;
        } else {
            result = s1len < s2len;
            return (result + result - 1);
        }
    },
    updateScrollR: function(element) {
        element.scrollLeft = element.scrollWidth;
    },
    isWindowObject: function(varVal) {
        return this.stringValue(varVal) == "[object Window]";
    },
    stringValue: function(val, stringify) {
        var returnVal = "";
        try {
            if (stringify || typeof val == "object") {
                returnVal = JSON.stringify(val);
            } else {
                returnVal = val.toString();
            }
        } catch (err) {
            returnVal = this.makeUpStringValue(val);
        }
        if (typeof returnVal != "string" || (returnVal == "" && typeof val != "string")) {
            returnVal = this.makeUpStringValue(val);
        }
        if (returnVal.length > JSDevtools.mainValues.totalValueCharLimit) {
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
    removeWindow: function(name) {
        var nameBeginning = name.substring(0, 7);
        while (nameBeginning == "window.") {
            name = name.substring(7, name.length);
            nameBeginning = name.substring(0, 7);
        }
        return name; 
    },
    makeValuePretty: function(val, type) {
        var stringVal = this.stringValue(val);
        var returnVal = "";
        if (this.valMayHaveChildren(val, type)) {
            returnVal = val;
        } else if (typeof val == "object" || type == "String") {
            try {
                returnVal = this.stringValue(val, true); 
            } catch(err) {
                returnVal = stringVal;
            }
        } else {
            returnVal = stringVal;
        }
        return returnVal;
    },
    objHasKeys: function(varName, varVal) {
        if (typeof varVal != "string" || varVal == "[object Window]") {
            return false;
        }
        for (var i = 0; i < JSDevtools.mainValues.nameArray.length; i++) {
            if (this.isObjKey(varName, i)) {
                return true;
            }
        }
        return false;
    },
    valMayHaveChildren: function(val, type) {
        var valType = this.typeOf(val); 
        return valType == "String" && JSDevtools.mainValues.typesWithNoChildren[type] != true && valType != type;  
    },
    shouldShowObject: function(varName) {
        return JSDevtools.mainValues.searchTerms[3] == JSDevtools.viewParentObject(varName, false);
    },
    duplicateNames: function(newName, oldName, modifyingName) {
        return this.NAIncludes(newName) && modifyingName && newName != oldName;
    },
    isObjKey: function(obj, index) {
        return JSDevtools.mainValues.nameArray[index].substring(0, obj.length) == obj && (this.isEndingChar(JSDevtools.mainValues.nameArray[index][obj.length]) || obj == "");
    }
}

JSDevtools.mainValues.blacklist = {
    "everything": JSDevtools.tools.createHashMap([]),
    "Window": JSDevtools.tools.createHashMap(["JSDiggerChromeExtension", Object.getOwnPropertyNames(window)])
},
    
JSDevtools.activateCommand = {
    "disableWaitingPrompt": function() {
        JSDevtools.waitingPrompt(0);  
    },
    "handleTabError": function(action) {
        if (JSDevtools.mainValues.inFailState == false) {
            JSDevtools.closeOpenMessage();
            JSDevtools.loadingPrompt(1);
            JSDevtools.failedTabScreens[action](true);
            clearInterval(JSDevtools.mainValues.pingInterval);
            JSDevtools.mainValues.pingReceived = false;
            JSDevtools.mainValues.pingInterval = setInterval(function() {
                JSDevtools.sendToContent("ping", 0);
            },500);
        }
    },
    "ping": function(sendStartup) {
        if (documentElement.getElementById("refreshPageProtection").style.height != "0px") {
            JSDevtools.startUp();
        } else if (sendStartup[0]) {
            if (sendStartup[0] == 1) {
                clearInterval(JSDevtools.mainValues.pingInterval);
                JSDevtools.mainValues.pingReceived = true;
                JSDevtools.mainValues.pingInterval = setInterval(function() {
                    JSDevtools.sendToContent("ping", 0);
                },500);
            } else {
                JSDevtools.updateScanLeft(sendStartup[1], sendStartup[2], sendStartup[3]);
            }
        }
    },
    "restart": function() {
        restartActivated = true; 
        JSDevtools.closeOpenMessage();
        clearInterval(JSDevtools.mainValues.pingInterval);
        JSDevtools.mainValues.pingReceived = false;
        JSDevtools.loadingPrompt(2);
        if (panelIsBeingViewed) {
            JSDevtools.sendToContent("injectJSDiggerContentScript", "contentScript.js");
            restartActivated = false; 
        }
    },
    "cancelAcknowledge": function() {
        JSDevtools.loadingPrompt(0);
    },
    "newVarSet": function(message) {
        JSDevtools.loadingPrompt(0);
        JSDevtools.closeOpenMessage();
        JSDevtools.mainValues.nameArray = message[0];
        JSDevtools.mainValues.valueArray = message[1];
        JSDevtools.mainValues.typeArray = message[2];
        JSDevtools.mainValues.scanLimit = message[3]; 
        JSDevtools.filterTerms(); 
    },
    "oneNewVar": function(message) {
        var newVar = message[0];
        var oldVar = message[1];
        var newVal = message[2];
        var displayedMessage = message[3];
        var originalNameData = message[4];
        
        var varParent = JSDevtools.viewParentObject(newVar, false);
        
        if (displayedMessage[1] == JSDevtools.mainValues.scriptedMessage[0]) {
            var mainArrayPlace = JSDevtools.tools.OSAIndexOf(JSDevtools.mainValues.nameArray, newVar);
            if (mainArrayPlace < 0) {
                mainArrayPlace = JSDevtools.tools.OSAIndexOf(JSDevtools.mainValues.nameArray, oldVar);
            }
            
            JSDevtools.displayMessage(displayedMessage[0], mainArrayPlace % JSDevtools.mainValues.totalTabs, (newVar == oldVar) * 1, displayedMessage[1], false);
        } else if (newVal == "undefined" && varParent.length) {
            if (!originalNameData) {
                originalNameData = [newVar, oldVar, displayedMessage, [0, newVar + " has been deleted"]];
            }
            JSDevtools.sendToContent("refreshOneVar", [varParent, 0, originalNameData]);
        } else {            
            JSDevtools.sendToContent("findNewObjectKeys", [newVar, oldVar, displayedMessage, JSDevtools.mainValues.scanLimit, JSDevtools.tools.getScanLimit(newVar), JSDevtools.removeOldKeys(newVar, oldVar), originalNameData]);
        }
    },
    "returnFromFNOK": function(message) {
        JSDevtools.mainValues.scanLimit = message[6];
        JSDevtools.mainValues.nameArray = JSDevtools.mainValues.nameArray.concat(message[0]);
        JSDevtools.mainValues.valueArray = JSDevtools.mainValues.valueArray.concat(message[1]);
        JSDevtools.mainValues.typeArray = JSDevtools.mainValues.typeArray.concat(message[2]);
        if (JSDevtools.mainValues.scriptedMessage[1] == message[5][1]) {
            JSDevtools.waitingPrompt(0);
            JSDevtools.viewObjectMethods();
        } else {
            if (message[7] && message[0].includes(message[7][0])) {
                message[3] = message[7][0];
                message[4] = message[7][1];
                message[5] = message[7][2];
            } else if (message[7] && message[7][3]) {
                message[5] = message[7][3];
            }
            JSDevtools.findAndDisplayValue(message[3], message[5], (message[3] == message[4]) * 1);
        }
    },
    "deliverSplitMessage": function(message) {
        if (JSDevtools.mainValues.parsedMessages[message.ID] == undefined) {
            JSDevtools.mainValues.parsedMessages[message.ID] = message.message;
        } else {
            JSDevtools.mainValues.parsedMessages[message.ID] += message.message;
        }
    }, 
    "executeSplitMessage": function(message) {
        JSDevtools.receiveFromContent(message.message, JSDevtools.mainValues.parsedMessages[message.ID]);
        delete JSDevtools.mainValues.parsedMessages[message.ID];
    }
}

JSDevtools.changeItem = function(name, val, type, row, addButtons) {  
    var fixedVal = this.tools.makeValuePretty(val, type);
    var varBar = documentElement.getElementsByClassName("varBar")[row];
    if (name == "" && (fixedVal == "\"\"" || fixedVal == "") && type == "") {
        varBar.style.display = "none";
    } else {
        varBar.style.display = "flex"; 
    }
    
    var varBarItemName = varBar.getElementsByClassName("varBarItemName")[0];
    var varBarItemValue = varBar.getElementsByClassName("varBarItemValue")[0];
    var varBarItemType = varBar.getElementsByClassName("varBarItemType")[0];
    
    varBarItemName.getElementsByClassName("varBox")[0].value = name; 
    varBarItemValue.getElementsByClassName("varBox")[0].value = fixedVal;
    varBarItemType.getElementsByClassName("varBox")[0].value = type; 
    
    if (JSDevtools.mainValues.functionBoxTypes[type] == true) {
        varBarItemValue.className = "varBarItem varBarItemValue functionBarItem";
        varBarItemValue.getElementsByClassName("varBox")[0].className = "varBox functionBox";
    } else {
        varBarItemValue.className = "varBarItem varBarItemValue";
        varBarItemValue.getElementsByClassName("varBox")[0].className = "varBox";
    }

    if (addButtons) {
        if (JSDevtools.tools.valMayHaveChildren(val, type) || (JSDevtools.tools.isTypeWithInstanceVars(val) && JSDevtools.tools.objHasKeys(name, val))) {
            documentElement.getElementsByClassName("varButtonObject")[row].style.display = "inline-block";
        } else {
            documentElement.getElementsByClassName("varButtonObject")[row].style.display = "none";
        }
    }

    this.tools.updateScrollR(varBarItemName.getElementsByClassName("varBox")[0]);
 }

JSDevtools.changeMenu = function(arrPlaces, newTabNum) {
    if (newTabNum != undefined && newTabNum != JSDevtools.mainValues.totalTabs) {
        var variableMenu = documentElement.getElementById("variableMenu");
        var tabsToUpdate = newTabNum - JSDevtools.mainValues.totalTabs;
        JSDevtools.mainValues.lastActiveBox = null;
        JSDevtools.mainValues.lastActiveSearchBox = null;
        if (tabsToUpdate > 0) {
            for (var i = 0; i < tabsToUpdate; i++) {
                variableMenu.appendChild(JSDevtools.tools.createNewVarBar());
                JSDevtools.tools.activateNewVarBar(JSDevtools.mainValues.totalTabs + i);
            }
        } else {
            var allTabs = variableMenu.getElementsByClassName("varBar");
            for (var i = (JSDevtools.mainValues.totalTabs - 1); i >= newTabNum; i--) {
                variableMenu.removeChild(allTabs[i]);
            }
        }
        
        JSDevtools.mainValues.totalTabs = newTabNum;
        documentElement.getElementById("tabsNum").value = JSDevtools.mainValues.totalTabs;
    }
    
    JSDevtools.mainValues.totalSectors = Math.ceil(JSDevtools.mainValues.displayPlaces.length / JSDevtools.mainValues.totalTabs);
    
    documentElement.getElementById("totalPages").innerHTML = this.tools.addCommasToNumber(JSDevtools.mainValues.totalSectors);
    if (JSDevtools.mainValues.totalSectors < 1) {
        JSDevtools.mainValues.sectorDisplay = JSDevtools.mainValues.totalSectors;
    }
     
    if (JSDevtools.mainValues.sectorDisplay > JSDevtools.mainValues.totalSectors) {
        JSDevtools.scrollListTo(JSDevtools.mainValues.totalSectors, true);
        return;
    }

    
    for (var i = 0; i < JSDevtools.mainValues.totalTabs; i++) {
        if (arrPlaces.length == 0) {
            this.changeItem("", "", "", i, false);
            if (!i) {
                this.showNoResult();
            }
        } else {
            documentElement.getElementById("noResultsFound").style.display = "none";
            if (arrPlaces[i] == undefined) {
                this.changeItem("", "", "", i, false);
            } else {
                this.changeItem(this.mainValues.nameArray[arrPlaces[i]], this.mainValues.valueArray[arrPlaces[i]], this.mainValues.typeArray[arrPlaces[i]], i, true);
            }
        }
    }
    
    this.closeOpenMessage();
    documentElement.getElementById("navigationBox").value = JSDevtools.mainValues.sectorDisplay;
}

JSDevtools.closeOpenMessage = function(newMessage) {
    var openMessageBox = documentElement.getElementsByClassName("messageBoxShowing"); 
    if (openMessageBox.length && openMessageBox[0] != newMessage) {
        this.closeMessage(openMessageBox[0]);
    }
}

JSDevtools.closeMessage = function(element) {
    var getOpacity = +(element.style.opacity) || 0.95; 
    var saveMessage = element.value; 
    
    JSDevtools.tools.interval(function(){
        getOpacity -= 0.05;
        element.style.opacity = getOpacity + "";
        if (getOpacity < 0.05) {
            element.style.opacity = 0.95;    
            element.value = "";
            element.className = "promptMessage";
            return true;
        }
        if (saveMessage != element.value) {
            element.style.opacity = 0.95;   
            return true; 
        }
        saveMessage = element.value;
    },25); 
}

JSDevtools.displayMessage = function(Success1Error0, row, col, message, forceScroll) {
    var messageBoxWrapper = documentElement.getElementsByClassName("varBar")[row].getElementsByClassName("varBarItem")[col];
    var messageBox = messageBoxWrapper.getElementsByClassName("promptMessage")[0];
    JSDevtools.closeOpenMessage(messageBox);
            
    if (Success1Error0) {
        messageBox.className += " successMessage";  
    } else {
        messageBox.className += " errorMessage";        
    }
    
    message = message.toUpperCase() + this.mainValues.messageAdditions[JSDevtools.mainValues.messageAdditionIndex];
    
    messageBox.value = message;
    messageBox.style.opacity = "0.95";
    messageBox.className += " messageBoxShowing";

    var varBar = documentElement.getElementsByClassName("varBar")[row]; 
    var variableMenu = documentElement.getElementById("variableMenu"); 
    if (forceScroll || (varBar.offsetTop < variableMenu.scrollTop || varBar.offsetTop > variableMenu.clientHeight - varBar.clientHeight)) {
        documentElement.getElementById("variableMenu").scrollTop = documentElement.getElementsByClassName("varBar")[row].offsetTop - Math.round(documentElement.getElementById("variableMenu").clientHeight / 2);
    }
    JSDevtools.waitingPrompt(0);
}

JSDevtools.showNoResult = function() {
    var scope = JSDevtools.changeScopeBox(JSDevtools.mainValues.searchTerms[3], true).toUpperCase();
    var buildMessage = ""; 
    if (scope == "WINDOW") {
        buildMessage += "NO RESULTS FOUND ON WEBPAGE";
    } else {
        buildMessage += 'NO RESULTS FOUND UNDER "' + scope + '"';
    }
    buildMessage += ' WITH QUERY<br>';
    
    var query = JSDevtools.mainValues.searchTerms.slice(0, 3);
    for (var i = 0; i < query.length; i++) {
        if (query[i].length > JSDevtools.mainValues.queryMaxLength) {
            query[i] = JSON.stringify(query[i].substring(0, JSDevtools.mainValues.queryMaxLength) + "...");
        } else if (query[i].length) {
            query[i] = JSON.stringify(query[i]);
        } else {
            continue;
        }
        buildMessage += '<br><div class="queryLabel">' + JSDevtools.mainValues.queryCategories[i] + " " + JSDevtools.mainValues.caseSensitivityText[JSDevtools.mainValues.savedCaseSensitivity[i]] + ':</div><div class="queryResult">' + query[i] + "</div>";
    }
    
    documentElement.getElementById("noResultsText").innerHTML = buildMessage;
    documentElement.getElementById("noResultsFound").style.display = "inline-block";
}

JSDevtools.scrollListTo = function(navigatorValue, scrollToTop) {
    if (!isNaN(navigatorValue) && navigatorValue > 0 && navigatorValue <= JSDevtools.mainValues.totalSectors) {
        if (JSDevtools.mainValues.sectorDisplay != navigatorValue && scrollToTop) {
            documentElement.getElementById("variableMenu").scrollTop = 0;                         
        }
        JSDevtools.mainValues.sectorDisplay = navigatorValue; 

        var sectorToArrayIndex = (JSDevtools.mainValues.sectorDisplay - 1) * JSDevtools.mainValues.totalTabs;
        JSDevtools.changeMenu(JSDevtools.mainValues.displayPlaces.slice(sectorToArrayIndex, sectorToArrayIndex + JSDevtools.mainValues.totalTabs));
        this.tools.drawAttention(documentElement.getElementById("navigationBox"), "", "drawGreenAttention");
    } else {
        documentElement.getElementById("navigationBox").value = JSDevtools.mainValues.sectorDisplay;
        this.tools.drawAttention(documentElement.getElementById("navigationBox"), "", "drawRedAttention");
    }
}

JSDevtools.changeTabNum = function(newTabNum) {
    if (!isNaN(newTabNum) && newTabNum > 0) {
        JSDevtools.mainValues.newTotalTabs = Math.min(newTabNum, JSDevtools.mainValues.maxTotalTabs);
        var sectorToArrayIndex = (JSDevtools.mainValues.sectorDisplay - 1) * JSDevtools.mainValues.newTotalTabs;
        JSDevtools.changeMenu(JSDevtools.mainValues.displayPlaces.slice(sectorToArrayIndex, sectorToArrayIndex + JSDevtools.mainValues.newTotalTabs), JSDevtools.mainValues.newTotalTabs);
        this.tools.drawAttention(documentElement.getElementById("tabsNum"), "", "drawGreenAttention");
    } else {
        this.tools.drawAttention(documentElement.getElementById("tabsNum"), "", "drawRedAttention");
    }
    documentElement.getElementById("tabsNum").value = JSDevtools.mainValues.totalTabs;
}

JSDevtools.tabAndPageBoxes = function(event, tab1Page0) {
    var key = event.which || event.keyCode;
    if (key == 13) {
        if (tab1Page0) {
            JSDevtools.changeTabNum(+(documentElement.getElementById("tabsNum").value))
        } else {
            JSDevtools.scrollListTo(+(documentElement.getElementById("navigationBox").value), true);
        }
    }
}

JSDevtools.receiveFromContent = function(command, message) {
    if (command != undefined) {
        this.mainValues.commandQueue[0].push(command);
        if (this.mainValues.parseCommandsBlacklist[command] == true) {
            this.mainValues.commandQueue[1].push(message);
        } else {
            this.mainValues.commandQueue[1].push(JSON.parse(message));
        }
    }

    if ((this.mainValues.commandQueue[0].length == 1 || (command == undefined && this.mainValues.commandQueue[0].length > 0)) && (JSDevtools.mainValues.commandRunning == false)) {
        JSDevtools.mainValues.commandRunning = true;
        this.activateCommand[this.mainValues.commandQueue[0][0]](this.mainValues.commandQueue[1][0]);
        JSDevtools.mainValues.commandRunning = false;
        this.mainValues.commandQueue[0].splice(0, 1);
        this.mainValues.commandQueue[1].splice(0, 1);
        JSDevtools.receiveFromContent();
    }
}

JSDevtools.sendToContent = function(command, message) {
    try {
        backgroundPageConnection.postMessage({
            command: command,
            message: message,
            tabId: chrome.devtools.inspectedWindow.tabId
        });
    } catch(err) { 
        this.failedTabScreens.handleExtensionReload();
    }
}

JSDevtools.scrollToTermOS = function(name) {
    var namePlace = JSDevtools.tools.OSAIndexOf(JSDevtools.mainValues.nameArray, name);
    if (namePlace > -1) {
        JSDevtools.scrollListTo(Math.floor(namePlace / JSDevtools.mainValues.totalTabs) + 1, false);
        return (namePlace % JSDevtools.mainValues.totalTabs);
    }
    return -1; 
}

JSDevtools.removeOldKeys = function(objName, oldObjName) {
    var charLength = 0;
    var holdNA = [];
    var holdVA = [];
    var holdTA = []; 
    var newEquOld = (objName == oldObjName);
    
    if (oldObjName == "") {
        oldObjName = objName;
    }
    
    for (var i = 0; i < JSDevtools.mainValues.nameArray.length; i++) {
        if (JSDevtools.mainValues.nameArray[i].substring(0, objName.length) != objName && (newEquOld || JSDevtools.mainValues.nameArray[i].substring(0, oldObjName.length) != oldObjName)) {
            holdNA.push(JSDevtools.mainValues.nameArray[i]);
            holdVA.push(JSDevtools.mainValues.valueArray[i]);
            holdTA.push(JSDevtools.mainValues.typeArray[i]);
            charLength += JSON.stringify(JSDevtools.mainValues.nameArray[i]).length + JSON.stringify(JSDevtools.mainValues.valueArray[i]).length + JSON.stringify(JSDevtools.mainValues.typeArray[i]).length + 3;
        }
    }
    
    JSDevtools.mainValues.nameArray = holdNA;
    JSDevtools.mainValues.valueArray = holdVA;
    JSDevtools.mainValues.typeArray = holdTA;
    return charLength;
}

JSDevtools.findTermOS = function(varName, newMessage, nameChanged0ValueChanged1, forceScroll) {
    var rowOfTerm = JSDevtools.scrollToTermOS(varName); 
    if (rowOfTerm > -1) {
        if (newMessage == undefined) {
            JSDevtools.waitingPrompt(0);
        } else {
            JSDevtools.displayMessage(newMessage[0], rowOfTerm, nameChanged0ValueChanged1, newMessage[1], forceScroll);
        }
        return true;
    }
    return false;
}

JSDevtools.findAndDisplayValue = function(varName, newMessage, nameChanged0ValueChanged1) {
    JSDevtools.filterTerms([varName, nameChanged0ValueChanged1]);
    if (!JSDevtools.findTermOS(varName, newMessage, nameChanged0ValueChanged1, JSDevtools.mainValues.messageAdditionIndex)) {
        JSDevtools.viewObjectMethods(undefined, JSDevtools.viewParentObject(varName, false));
        if (!JSDevtools.findTermOS(varName, newMessage, nameChanged0ValueChanged1, true)) {
            JSDevtools.waitingPrompt(0);
        }
    }
    JSDevtools.mainValues.messageAdditionIndex = 0;
}

JSDevtools.scrollLeft = function() {
    var newScrollValue = JSDevtools.mainValues.sectorDisplay - 1; 
    if (newScrollValue < 1) {
        newScrollValue = JSDevtools.mainValues.totalSectors;
    }
    JSDevtools.scrollListTo(newScrollValue, true);
}

JSDevtools.scrollRight = function() {
    var newScrollValue = JSDevtools.mainValues.sectorDisplay + 1; 
    if (newScrollValue > JSDevtools.mainValues.totalSectors) {
        newScrollValue = 1;
    }
    JSDevtools.scrollListTo(newScrollValue, true);
}

JSDevtools.identifyVarBox = function(box) {
    var getRow = JSDevtools.identifyPlace(box);
    if (getRow == -1) {
        return [];
    } 
    var getCol = 0;
    var getBoxElement = documentElement.getElementsByClassName("varBar")[getRow].getElementsByClassName("varBox");
    if (getBoxElement[1] == box) {
        getCol = 1; 
    }
    return [getRow, getCol, getBoxElement];
}

JSDevtools.getVarBarParent = function(elem) {
    while (elem != null && elem.className != "varBar") {
        elem = elem.parentElement; 
    }
    return elem;
}

JSDevtools.identifySearchMenuItem = function(elem) {
    elem = elem.parentElement;
    var toggleBarItems = documentElement.getElementsByClassName("searchMenuItem");
    for (var i = 0; i < toggleBarItems.length; i++) {
        if (elem == toggleBarItems[i]) {
            return i;
        }
    }
    return -1; 
}

JSDevtools.identifyPlace = function(thisRowElem) {
    var varBarElem = this.getVarBarParent(thisRowElem);
    var varBars = documentElement.getElementsByClassName("varBar");
    for (var i = 0; i < varBars.length; i++) {
        if (varBars[i] == varBarElem) {
            return i; 
        }
    }
    return -1;
}

JSDevtools.restoreValueOfSearchBox = function(pastBox, currentBox) {
    if (currentBox != undefined) {
        JSDevtools.restoreValueOfVarBox(JSDevtools.mainValues.lastActiveBox);
    }
    if (pastBox == null || pastBox == currentBox) {return};
    var boxNum = 0;
    var allBoxes = documentElement.getElementsByClassName("searchBox");
    for (var i = 0; i < allBoxes.length; i++) {
        if (allBoxes[i] == pastBox) {
            boxNum = i;
            break; 
        }
    }
    allBoxes[boxNum].value = this.mainValues.searchTerms[boxNum]; 
}

JSDevtools.restoreValueOfVarBox = function(pastBox, currentBox) {
    if (currentBox != undefined) {
        JSDevtools.restoreValueOfSearchBox(JSDevtools.mainValues.lastActiveSearchBox);
    }
    if (pastBox == null || pastBox == currentBox) {return};
    var getBox = JSDevtools.identifyVarBox(pastBox);
    if (getBox.length == 0) {
        return; 
    }
    var arrayIndex = ((JSDevtools.mainValues.sectorDisplay - 1) * JSDevtools.mainValues.totalTabs) + getBox[0];
    if (JSDevtools.mainValues.nameArray[JSDevtools.mainValues.displayPlaces[arrayIndex]] != undefined) {
        JSDevtools.changeItem(JSDevtools.mainValues.nameArray[JSDevtools.mainValues.displayPlaces[arrayIndex]], JSDevtools.mainValues.valueArray[JSDevtools.mainValues.displayPlaces[arrayIndex]], JSDevtools.mainValues.typeArray[JSDevtools.mainValues.displayPlaces[arrayIndex]], arrayIndex % JSDevtools.mainValues.totalTabs, false);
    }
}

JSDevtools.refreshOneVar = function(rowElem, viewObj2Console1Refresh0) {
    JSDevtools.waitingPrompt(1);
    this.sendToContent("refreshOneVar", [JSDevtools.mainValues.nameArray[JSDevtools.mainValues.displayPlaces[((JSDevtools.mainValues.sectorDisplay - 1) * JSDevtools.mainValues.totalTabs) + JSDevtools.identifyPlace(rowElem)]], viewObj2Console1Refresh0]);
}

JSDevtools.updateVar = function(rawKey, boxRow) {
    var key = rawKey.which || rawKey.keyCode;
    if (key == 13) {
        boxRow.blur();
        var getBoxInfo = JSDevtools.identifyVarBox(boxRow);
        var getRow = getBoxInfo[0];
        var getCol = getBoxInfo[1];
        var getVarBoxes = getBoxInfo[2];
        var variableIndexInNA = ((JSDevtools.mainValues.sectorDisplay - 1) * JSDevtools.mainValues.totalTabs) + getRow;
        var newVarName = JSDevtools.tools.removeWindow(getVarBoxes[0].value);
        var newVarVal = getVarBoxes[1].value; 
        var getOldVar = JSDevtools.mainValues.nameArray[JSDevtools.mainValues.displayPlaces[variableIndexInNA]];
        if (this.tools.isAllWhiteSpace(newVarName)) {
            JSDevtools.receiveFromContent("oneNewVar", JSON.stringify([JSDevtools.mainValues.nameArray[JSDevtools.mainValues.displayPlaces[variableIndexInNA]], "", JSDevtools.mainValues.valueArray[JSDevtools.mainValues.displayPlaces[variableIndexInNA]], [0, "NO NAME GIVEN"]])); 
        } else if (this.tools.isAllWhiteSpace(newVarVal)) {
            JSDevtools.receiveFromContent("oneNewVar", JSON.stringify([JSDevtools.mainValues.nameArray[JSDevtools.mainValues.displayPlaces[variableIndexInNA]], JSDevtools.mainValues.nameArray[JSDevtools.mainValues.displayPlaces[variableIndexInNA]],  JSDevtools.mainValues.valueArray[JSDevtools.mainValues.displayPlaces[variableIndexInNA]], [0, "NO VALUE GIVEN"]])); 
        } else if (JSDevtools.tools.duplicateNames(newVarName, getOldVar, getCol == 0)) {
            JSDevtools.receiveFromContent("oneNewVar", JSON.stringify([JSDevtools.mainValues.nameArray[JSDevtools.mainValues.displayPlaces[variableIndexInNA]], "",  JSDevtools.mainValues.valueArray[JSDevtools.mainValues.displayPlaces[variableIndexInNA]], [0, newVarName + " ALREADY DEFINED"]])); 
        } else {
            JSDevtools.waitingPrompt(1);
            this.sendToContent("updateVar", [newVarName, newVarVal, getOldVar, getCol == 0]);
        }
    }
}

JSDevtools.reverseListOrder = function() {
    var AZIcons = documentElement.getElementsByClassName("sortDirection");
    this.mainValues.searchTerms[4] = !this.mainValues.searchTerms[4]
    if (this.mainValues.searchTerms[4]) {
        for (var i = 0; i < AZIcons.length; i++) {
            AZIcons[i].src = "Images/A-Z.png";
        }
    } else {
        for (var i = 0; i < AZIcons.length; i++) {
            AZIcons[i].src = "Images/Z-A.png";
        }
    }
        
    var saveSectorDisplay = JSDevtools.mainValues.sectorDisplay; 
    JSDevtools.orderList();
    JSDevtools.scrollListTo(Math.min(saveSectorDisplay, JSDevtools.mainValues.totalSectors), false);
}

JSDevtools.orderList = function(Name0Val1Type2) {
    if (Name0Val1Type2 != undefined) {
        documentElement.getElementsByClassName("sortDirection")[this.mainValues.organizeBy].style.display = "none";
        documentElement.getElementsByClassName("sortDirection")[Name0Val1Type2].style.display = "inline-block";
        this.mainValues.organizeBy = Name0Val1Type2;
    } else {
        documentElement.getElementsByClassName("sortDirection")[this.mainValues.organizeBy].style.display = "inline-block";
        Name0Val1Type2 = this.mainValues.organizeBy;
    }
    JSDevtools.mainValues.sortArray = [];
    
    if (Name0Val1Type2 == 2) {
        JSDevtools.mainValues.sortArray = JSDevtools.mainValues.typeArray;
    } else if (Name0Val1Type2 == 1) {
        JSDevtools.mainValues.sortArray = JSDevtools.mainValues.valueArray;
    } else {
        JSDevtools.mainValues.sortArray = JSDevtools.mainValues.nameArray;
    }

    JSDevtools.mainValues.displayPlaces = JSDevtools.tools.mergesort(JSDevtools.mainValues.displayPlaces, JSDevtools.mainValues.searchTerms[4], function(place1, place2) {
        return JSDevtools.tools.compareSortedValues(place1, place2, Name0Val1Type2);
    });
    
    JSDevtools.mainValues.totalSectors = 1; 
    JSDevtools.mainValues.sectorDisplay = 1; 
    JSDevtools.loadingPrompt(0);
    JSDevtools.closeOpenMessage();
    JSDevtools.changeMenu(JSDevtools.mainValues.displayPlaces.slice(0, JSDevtools.mainValues.newTotalTabs), JSDevtools.mainValues.newTotalTabs);
}

JSDevtools.changeListOrder = function(menuItem) {
    var findItem = 0;
    var menuItems = documentElement.getElementsByClassName("organizeItem");
    for (var i = 0; i < menuItems.length; i++) {
        if (menuItems[i] == menuItem) {
            findItem = i;
            if (menuItems[i].className.length <= 26) {
                menuItems[i].className += " organizeItemClicked";
            } else {
                JSDevtools.reverseListOrder();
                return;
            }
        } else {
            menuItems[i].className = "toggleBarItem organizeItem";
        }
    }
    JSDevtools.closeOpenMessage();
    JSDevtools.orderList(findItem);
}

JSDevtools.changeScopeBox = function(val, returnVal) {
    if (returnVal) {
        return val || "Window";
    } else if (val == "") {
        documentElement.getElementById("scopeButton").className = "topofobj";
        val = "Window";
    } else {
        documentElement.getElementById("scopeButton").className = "";
    }
    var scopeBox = documentElement.getElementById("scopeBox");
    scopeBox.value = val;
    this.tools.updateScrollR(scopeBox);
    this.tools.drawAttention(scopeBox, "scopeBox", "drawGreenAttention");
}

JSDevtools.viewObjectMethods = function(button, objectName) {
    if (objectName != undefined) {
        JSDevtools.mainValues.searchTerms[3] = objectName;
    } else if (button != undefined) {
        var index = JSDevtools.mainValues.displayPlaces[((JSDevtools.mainValues.sectorDisplay - 1) * JSDevtools.mainValues.totalTabs) + JSDevtools.identifyPlace(button)];
        JSDevtools.mainValues.searchTerms[3] = JSDevtools.mainValues.nameArray[index];
        if (JSDevtools.tools.objHasKeys(JSDevtools.mainValues.nameArray[index], JSDevtools.mainValues.valueArray[index]) == false) {
            JSDevtools.changeScopeBox(JSDevtools.mainValues.searchTerms[3]);
            JSDevtools.refreshOneVar(button, 2);
            return;
        }
    }
    
    JSDevtools.clearSearchTerms();
    JSDevtools.changeScopeBox(JSDevtools.mainValues.searchTerms[3]);
    JSDevtools.filterTerms();
}

JSDevtools.viewParentObject = function(findSpecificObject, runAnyway, reset, findVarInfo) {
    if (documentElement.getElementById("scopeButton").className != "topofobj" || findSpecificObject || runAnyway) {
        var objectTerm;
        if (reset) {
            objectTerm = "";
        } else {
            if (findSpecificObject) {
                objectTerm = findSpecificObject;
            } else {
                objectTerm = JSDevtools.mainValues.searchTerms[3];
            }
            var searchingForNewTerm = true;
            var lastChar;
            while (searchingForNewTerm) {
                lastChar = objectTerm[objectTerm.length - 1];
                objectTerm = objectTerm.substring(0, objectTerm.length - 1);
                searchingForNewTerm = !((JSDevtools.tools.NAIncludes(objectTerm) && JSDevtools.tools.isEndingChar(lastChar)) || objectTerm == "");
            }
            if (findSpecificObject) {
                return objectTerm;
            }
        }

        JSDevtools.mainValues.searchTerms[3] = objectTerm;
        JSDevtools.changeScopeBox(JSDevtools.mainValues.searchTerms[3]);
        
        if (!reset) {
            JSDevtools.filterTerms(findVarInfo);
        }
    }
}

JSDevtools.toggleSearchButton = function(button, back1search0) {
    if (back1search0) {
        button.className = "searchButton backButton";
        button.setAttribute("title", "Back");
    } else {
        button.className = "searchButton"; 
        button.setAttribute("title", "Search");
    }
    button.getElementsByTagName("img")[0].src = JSDevtools.mainValues.searchButtomImg[back1search0];
}

JSDevtools.adjustSearchButton = function(elem) {
    var index = this.identifySearchMenuItem(elem);
    var button = documentElement.getElementsByClassName("searchButton")[index];
    var box = documentElement.getElementsByClassName("searchBox")[index];
        
    var buttonCondition = (this.tools.isAllWhiteSpace(box.value) || (JSDevtools.mainValues.searchTerms[index] == box.value && this.mainValues.changedCaseSensitivity[index] == this.mainValues.savedCaseSensitivity[index])) && JSDevtools.mainValues.searchTerms[index].length > 0;
    JSDevtools.toggleSearchButton(button, buttonCondition * 1);
}

JSDevtools.textboxActivateSearch = function(box, event) {
    JSDevtools.adjustSearchButton(box);
    var key = event.which || event.keyCode;
    if (key == 13) {
        box.blur();
        JSDevtools.activateSearch(box.parentElement.getElementsByClassName("searchButton")[0]);
    }
}

 JSDevtools.activateSearch = function(button, clearSearch, doNotCallSFT) {
    var buttonNumber = 0;
     
    if (isNaN(button)) {
        buttonNumber = this.identifySearchMenuItem(button);
    } else {
        buttonNumber = button; 
        button = documentElement.getElementsByClassName("searchButton")[buttonNumber];
    }
    
    var searchBox = button.parentElement.getElementsByClassName("searchBox")[0];
     
    if (this.tools.isAllWhiteSpace(searchBox.value) && button.className == "searchButton") {
        return;
    }

    if (button.className == "searchButton" && !clearSearch) {
        JSDevtools.toggleSearchButton(button, 1);
        JSDevtools.mainValues.searchTerms[buttonNumber] = this.tools.removeNewLines(searchBox.value);
    } else {
        JSDevtools.toggleSearchButton(button, 0);
        JSDevtools.mainValues.searchTerms[buttonNumber] = ""; 
        searchBox.value = "";
    }
     
    this.mainValues.savedCaseSensitivity[buttonNumber] = this.mainValues.changedCaseSensitivity[buttonNumber];
     
    if (!doNotCallSFT) {
        JSDevtools.filterTerms();
    }
}

JSDevtools.caseSensitiveSearch = function(fullTerm, searchText, place) {
    if (this.mainValues.savedCaseSensitivity[place] == 2) {
        return fullTerm == searchText;
    } else {
        return JSDevtools.tools.includesPattern(fullTerm, searchText, this.mainValues.savedCaseSensitivity[place] != 1);   
    }
}

JSDevtools.toggleSearchMode = function(activeButton) {
    var allModeButtons = documentElement.getElementsByClassName("modeButton");
    var buttonID = 0; 
    for (var i = 0; i < allModeButtons.length; i++) {
        if (allModeButtons[i] == activeButton) {
            buttonID = i;
            break;
        }
    }
    this.mainValues.changedCaseSensitivity[buttonID] += 1; 
    
    if (this.mainValues.changedCaseSensitivity[buttonID] > 2) {
        this.mainValues.changedCaseSensitivity[buttonID] = 0;
    }
    
    activeButton.getElementsByTagName("img")[0].src = this.mainValues.caseSensitivityImg[this.mainValues.changedCaseSensitivity[buttonID]];
    activeButton.setAttribute("title", this.mainValues.caseSensitivityTitles[this.mainValues.changedCaseSensitivity[buttonID]]);
    activeButton.className = "modeButton";
    if (this.mainValues.changedCaseSensitivity[buttonID]) {
        activeButton.className += " modeButtonPressed";
    }
    JSDevtools.adjustSearchButton(activeButton);
}

JSDevtools.searchTermMatch = function(name, value, type) {
    var allSearchTerms = JSDevtools.mainValues.searchTerms;
    var result = true;
    if (allSearchTerms[2].length) {
        result = result && this.caseSensitiveSearch(this.tools.removeNewLines(type), allSearchTerms[2], 2);
    }
    if (allSearchTerms[0].length) {
        result = result && this.caseSensitiveSearch(this.tools.removeNewLines(name), allSearchTerms[0], 0);
    }
    if (allSearchTerms[1].length) {
        result = result && this.caseSensitiveSearch(this.tools.removeNewLines(this.tools.makeValuePretty(value, type)), allSearchTerms[1], 1);
    }
    return result;
}

JSDevtools.clearSearchTerms = function() {
    var searchButtons = documentElement.getElementsByClassName("searchButton");
    for (var i = 0; i < searchButtons.length; i++) {
        JSDevtools.activateSearch(searchButtons[i], true, true);
    }
}

JSDevtools.filterTerms = function(findVarInfo) {
    this.mainValues.displayPlaces = [];
    var allSearchTerms = this.mainValues.searchTerms;
    var noSearchQuery = (allSearchTerms[0] == "" && allSearchTerms[1] == "" && allSearchTerms[2] == "");
    var scopeVal;
    var searchingForTerm = findVarInfo != undefined;
    var indexOfTerm = -1;
    
    var NA = this.mainValues.nameArray;
    var VA = this.mainValues.valueArray;
    var TA = this.mainValues.typeArray;
    
    JSDevtools.tools.resetNASearch(); 
    
    for (var i = 0; i < NA.length; i++) {
        if (NA[i] == allSearchTerms[3]) {
            scopeVal = VA[i];
        }
        if (JSDevtools.tools.isObjKey(allSearchTerms[3], i) && (noSearchQuery == false || this.tools.shouldShowObject(NA[i])) && this.searchTermMatch(NA[i], VA[i], TA[i])) {
            this.mainValues.displayPlaces.push(i);
            if (searchingForTerm && NA[i] == findVarInfo[0]) {
                indexOfTerm = i;
            }
        }
    }
    
    if (allSearchTerms[3].length && (JSDevtools.tools.isWindowObject(scopeVal) || (noSearchQuery && !this.mainValues.displayPlaces.length) || (searchingForTerm && indexOfTerm == -1))) {
        JSDevtools.mainValues.messageAdditionIndex = (searchingForTerm * 1);
        this.viewParentObject(false, true, false, findVarInfo); 
    } else if (searchingForTerm && indexOfTerm == -1 && allSearchTerms[3].length == 0 && allSearchTerms[findVarInfo[1]].length) {
        JSDevtools.mainValues.messageAdditionIndex = (searchingForTerm * 2);
        this.activateSearch(findVarInfo[1], true);
    } else {
        this.orderList();
    }
}

JSDevtools.loadingPrompt = function(start2Open1Close0) {
    switch (start2Open1Close0) {
        case 2: 
            JSDevtools.waitingPrompt(0);
            JSDevtools.mainValues.inFailState = false; 
            JSDevtools.mainValues.scanPromptShownBefore = false;
            JSDevtools.mainValues.firstScanStarted = false;
            JSDevtools.mainValues.nameArray = [];
            JSDevtools.mainValues.valueArray = [];
            JSDevtools.mainValues.typeArray = [];
            JSDevtools.mainValues.displayPlaces = [];
            JSDevtools.mainValues.NASearch.clear();
            
            documentElement.getElementById("loadingPromptButtonTextboxWrapper").style.marginTop = "2.4vmin";
            documentElement.getElementById("loadingPromptHeaderText").innerHTML = "Press <i>New Scan</i> to start scanning";
            documentElement.getElementById("loadingPromptSubText").value = ""; 
            documentElement.getElementById("JSDiggerLoading").src = "Logos/fullLogo.png";
            documentElement.getElementById("loadingPromptMainButton").getElementsByTagName("span")[0].innerHTML = "NEW SCAN";
            documentElement.getElementById("loadingPromptCancel").style.display = "none";
            documentElement.getElementById("lengthWarning").className = "";
            documentElement.getElementById("loadingPrompt").style.display = "block";
            documentElement.getElementById("blurPage").style.display = "inline-block";
            documentElement.getElementById("loadingPromptMainButton").style.display = "inline-flex";
            break;
        case 1: 
            JSDevtools.waitingPrompt(0);
            this.mainValues.firstScanStarted = true;
            documentElement.getElementById("loadingPromptHeaderText").innerHTML = "Variables Collected: 0 (0%)";
            documentElement.getElementById("loadingPromptSubText").value = "Collecting From: Window Object"; 
            documentElement.getElementById("JSDiggerLoading").src = "Images/loadingIcon.gif";
            documentElement.getElementById("loadingPromptMainButton").getElementsByTagName("span")[0].innerHTML = "END SCAN EARLY";
            documentElement.getElementById("lengthWarning").className = "";
            documentElement.getElementById("loadingPrompt").style.display = "block";
            documentElement.getElementById("blurPage").style.display = "inline-block";
            documentElement.getElementById("loadingPromptMainButton").style.display = "inline-flex";

            if (JSDevtools.mainValues.scanPromptShownBefore) {
                documentElement.getElementById("loadingPromptCancel").style.display = "inline-flex";
            } else {
                documentElement.getElementById("loadingPromptCancel").style.display = "none";
                JSDevtools.viewParentObject(false, false, true);
                JSDevtools.clearSearchTerms();
                JSDevtools.mainValues.scanPromptShownBefore = true; 
            }
            break;
        default: 
            documentElement.getElementById("loadingPrompt").style.display = "none";
            documentElement.getElementById("blurPage").style.display = "none";
    }
}

JSDevtools.waitingPrompt = function(open1Close0) {
    if (open1Close0) {
        JSDevtools.loadingPrompt(0);
        documentElement.getElementById("waitingPrompt").style.display = "block";
        documentElement.getElementById("blurPage").style.display = "inline-block";
        documentElement.body.style.cursor = "progress";
    } else {
        documentElement.getElementById("waitingPrompt").style.display = "none";
        documentElement.getElementById("blurPage").style.display = "none";
        documentElement.body.style.cursor = "default";
    }
}

JSDevtools.refreshAll = function() {
    JSDevtools.closeOpenMessage();
    JSDevtools.loadingPrompt(1);
    this.sendToContent("beginNewScan", 0);
}

JSDevtools.failedTabScreens = {
    "handleExtensionReload": function() {
        JSDevtools.closeOpenMessage();
        clearInterval(JSDevtools.mainValues.pingInterval);
        JSDevtools.mainValues.pingReceived = false;
        JSDevtools.loadingPrompt(1); 
        this.handleNullTabId(true);
        documentElement.getElementById("loadingPromptHeaderText").innerHTML = "JS DIGGER MAY HAVE UPDATED";
        documentElement.getElementById("loadingPromptSubText").value = "JS Digger may have updated, please reopen Dev. Tools";
    },
    "handleFilePermissionRequest": function() {
        JSDevtools.mainValues.inFailState = true;
        documentElement.getElementById("loadingPromptButtonTextboxWrapper").style.marginTop = "4.8vmin";
        documentElement.getElementById("loadingPromptHeaderText").innerHTML = "JS DIGGER NEEDS PERMISSION";
        documentElement.getElementById("loadingPromptSubText").value = 'Please allow access to file URLs in chrome://extensions';
        documentElement.getElementById("JSDiggerLoading").src = "Images/permission.png";
        documentElement.getElementById("loadingPromptCancel").style.display = "none";
        documentElement.getElementById("loadingPromptMainButton").style.display = "none";
    },
    "handleNullTabId": function(forcePrompt) {
        if (chrome.devtools.inspectedWindow.tabId == null || forcePrompt) {
            JSDevtools.mainValues.inFailState = true;
            documentElement.getElementById("loadingPromptButtonTextboxWrapper").style.marginTop = "4.8vmin";
            documentElement.getElementById("loadingPromptHeaderText").innerHTML = "UNABLE TO SCAN THIS WEBPAGE";
            documentElement.getElementById("loadingPromptSubText").value = "We're sorry, JS Digger is unable to run on this page";
            documentElement.getElementById("JSDiggerLoading").src = "Images/oops.png";
            documentElement.getElementById("loadingPromptCancel").style.display = "none";
            documentElement.getElementById("loadingPromptMainButton").style.display = "none";
            return true;
        }
        return false; 
    }
}

JSDevtools.updateScanLeft = function(totalScanned, percent, scanLimit) {
    if (this.mainValues.firstScanStarted == false) {
        JSDevtools.loadingPrompt(1);
    }
    
    var output = totalScanned + " (" + percent + "%)";
    var labels = ["Variables Collected: ", "Collected: ", ""];
    var labelsIndex = 0; 
    var loadingPrompt = documentElement.getElementById("loadingPromptHeaderText"); 
    var subText = documentElement.getElementById("loadingPromptSubText");
    var lengthWarning = documentElement.getElementById("lengthWarning");
    
    loadingPrompt.innerHTML = labels[labelsIndex] + output;
    while (loadingPrompt.offsetWidth < loadingPrompt.scrollWidth && labelsIndex < labels.length - 1) {
        labelsIndex += 1; 
        loadingPrompt.innerHTML = labels[labelsIndex] + output;
    }
    
    if (scanLimit != undefined) {
        var loadingPromptSubText = JSDevtools.tools.generateScanLimitText(scanLimit);
        subText.value = "Collecting From: " + loadingPromptSubText;
        if (subText.offsetWidth < subText.scrollWidth) {
            subText.value = loadingPromptSubText;
        }
    } else {
        subText.value = "Done Collecting: Processing and ordering data...";
    }
    
    if (totalScanned > JSDevtools.mainValues.warningTriggerLimit) {
        lengthWarning.className = "warningActive";
    } else {
        lengthWarning.className = "";
    }
    
    this.tools.updateScrollR(subText);
}

JSDevtools.startUp = function() { 
    var organizers = documentElement.getElementsByClassName("organizeItem");
    var modeButtons = documentElement.getElementsByClassName("modeButton");
    var searchButtons = documentElement.getElementsByClassName("searchButton");
    var searchBoxes = documentElement.getElementsByClassName("searchBox");
    var objectButtons = documentElement.getElementsByClassName("varButtonObject");
    var allBoxes = documentElement.getElementsByTagName("input");
    for (var i = 0; i < documentElement.getElementsByTagName("input").length; i++) {
        allBoxes[i].setAttribute("spellcheck", false);
        allBoxes[i].setAttribute("autocorrect", "off");
        allBoxes[i].setAttribute("autocapitalize", "off");
        allBoxes[i].setAttribute("maxlength", JSDevtools.mainValues.totalValueCharLimit);
    }

    documentElement.getElementById("navigationBox").value = "0";

    documentElement.getElementById("navigationBox").addEventListener("focus", function(){
        documentElement.getElementById("navigationBox").select();
    });
    
    documentElement.getElementById("navigationWrapper").addEventListener("wheel", JSDevtools.tools.horizontalScrolling);
    
    documentElement.getElementById("navigationBox").addEventListener("blur", function(){
        setTimeout(function() {
            documentElement.getElementById("navigationBox").value = JSDevtools.mainValues.sectorDisplay; 
        }, 0);
    });

    documentElement.getElementById("navigationBox").addEventListener("keyup", function(event){
        JSDevtools.tabAndPageBoxes(event, 0);
    });
    
    documentElement.getElementById("tabsNum").value = JSDevtools.mainValues.totalTabs;

    documentElement.getElementById("tabsNum").addEventListener("focus", function(){
        documentElement.getElementById("tabsNum").select();
    });

    documentElement.getElementById("tabsNum").addEventListener("blur", function(){
        setTimeout(function() {
            documentElement.getElementById("tabsNum").value = JSDevtools.mainValues.totalTabs; 
        }, 0);
    });

    documentElement.getElementById("tabsNum").addEventListener("keyup", function(event){
        JSDevtools.tabAndPageBoxes(event, 1);
    });

    documentElement.getElementById("scopeButton").addEventListener("click", function(){
        JSDevtools.viewParentObject();
    });
    
    documentElement.getElementById("scopeButton").setAttribute("title", "Broaden scope of results");

    documentElement.getElementById("refreshAllButton").addEventListener("click", function(){
        JSDevtools.refreshAll();
    });
    
    documentElement.getElementById("loadingPromptMainButton").addEventListener("click", function(){
        if (JSDevtools.mainValues.firstScanStarted) {
            JSDevtools.sendToContent("stopScan", 0);
        } else if (JSDevtools.mainValues.pingReceived) {
            JSDevtools.sendToContent("beginNewScan", JSDevtools.mainValues.blacklist);
            JSDevtools.loadingPrompt(1);
        }
    });

    documentElement.getElementById("loadingPromptCancel").addEventListener("click", function(){
        JSDevtools.sendToContent("cancelScan", 0);
    });

    documentElement.getElementById("scopeBox").addEventListener("blur", function(){
        setTimeout(function() {JSDevtools.tools.updateScrollR(documentElement.getElementById("scopeBox"));}, 0);
    });

    for (var i = 0; i < searchBoxes.length; i++) {
        modeButtons[i].addEventListener("click", function(event) {
            JSDevtools.toggleSearchMode(this);
        }); 
        modeButtons[i].setAttribute("title", JSDevtools.mainValues.caseSensitivityTitles[0]);
        searchBoxes[i].addEventListener("focus", function(){
            JSDevtools.restoreValueOfSearchBox(JSDevtools.mainValues.lastActiveSearchBox, this);
            JSDevtools.mainValues.lastActiveSearchBox = this; 
        });
        searchBoxes[i].addEventListener("keyup", function(event){
           JSDevtools.textboxActivateSearch(this, event);
        });

        organizers[i].addEventListener("click", function() {
            JSDevtools.changeListOrder(this);
        });
        searchButtons[i].addEventListener("click", function(event){
            if (event.detail > 1) {return}
            JSDevtools.activateSearch(this);
        });
        searchButtons[i].setAttribute("title", "Search");
    }
    
    documentElement.getElementById("leftButton").addEventListener("mousedown",function(){ documentElement.getElementById("leftButton").src = JSDevtools.arrowPhotos[2];});
    documentElement.getElementById("leftButton").addEventListener("mouseup",function(){ documentElement.getElementById("leftButton").src = JSDevtools.arrowPhotos[0]; JSDevtools.scrollLeft();}); 
    documentElement.getElementById("rightButton").addEventListener("mousedown",function(){ documentElement.getElementById("rightButton").src = JSDevtools.arrowPhotos[3];});
    documentElement.getElementById("rightButton").addEventListener("mouseup",function(){ documentElement.getElementById("rightButton").src = JSDevtools.arrowPhotos[1]; JSDevtools.scrollRight();}); 
    documentElement.getElementById("leftButton").addEventListener("mouseleave",function(){ documentElement.getElementById("leftButton").src = JSDevtools.arrowPhotos[0];});
    documentElement.getElementById("rightButton").addEventListener("mouseleave",function(){ documentElement.getElementById("rightButton").src = JSDevtools.arrowPhotos[1];}); 
    
    documentElement.getElementById("refreshPageProtection").style.height = "0px";
    JSDevtools.mainValues.totalTabs = 0; 
    JSDevtools.loadingPrompt(2);
    
    if (!JSDevtools.failedTabScreens.handleNullTabId()) {
        JSDevtools.sendToContent("injectJSDiggerContentScript", "contentScript.js"); 
    }
}