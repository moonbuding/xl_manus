/* global chrome */

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({
    serverUrl: "http://localhost:3001"
  });
});
