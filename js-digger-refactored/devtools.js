chrome.devtools.panels.create(
  'JS Digger',
  'icons/icon16.png',
  'panel.html',
  function (panel) {
    panel.onShown.addListener(function(panelWindow) {
      // Notify the panel that it should establish connection
      panelWindow.establishConnection();
    });
  }
);