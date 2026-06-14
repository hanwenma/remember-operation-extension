# Remember Operation Extension

A dependency-free Chrome/Edge extension MVP for recording and replaying user operations without changing the original web application.

## Features

- Record clicks, inputs, and selects as operation steps.
- Replay saved recordings from the in-page panel.
- Inspect and copy the saved JSON for each recording.
- Delete individual recordings.
- Clicks are recorded with structured event paths based on the clicked element and its clickable ancestor.

## Install

1. Open Chrome or Edge.
2. Go to the extensions page:
   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`
3. Enable Developer mode.
4. Click "Load unpacked".
5. Select this folder: `remember-operation-extension`.

## Use

Click the browser extension icon to open or close the in-page panel.

- `Start recording`: record clicks, inputs, and selects.
- `Stop and save`: stop recording and save the operation flow.
- Saved recordings can be viewed, copied, replayed, or deleted from the panel.

## Design

The extension focuses on operation recording:

- Click recording stores structured paths from `event.composedPath()`.
- Replay resolves elements by structured path first, then falls back to attributes, relative selector, and index.
- Text and coordinates are not used as primary locators.

## Suggested next steps

- Add import/export for recordings.
- Add configurable replay delay.
- Add a recording list management page if the panel becomes crowded.
