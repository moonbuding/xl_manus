# ManusXL Local Browser Extension

This is a Manifest V3 development extension for pairing Chrome with ManusXL.

## Install in Chrome

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click Load unpacked.
4. Select `manusxl-next/browser_extension`.
5. In ManusXL Settings, generate a local browser pairing code.
6. Open the extension popup and enter the code.

The extension stores a local pairing token in `chrome.storage.local` and polls ManusXL for the current pause state and recent browser operations.

The popup can also pause or resume local browser operations without opening the ManusXL Settings page.
