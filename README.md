# Deep Search Tool

A powerful Chrome extension for deep searching JavaScript objects on web pages.

## Project Structure

- `search-core.js` - Core search algorithm and utilities
- `ui-components.js` - UI creation and rendering functions
- `main.js` - Entry point that initializes the search UI
- `manifest.json` - Chrome extension manifest
- `popup.html` - Extension popup interface
- `popup.js` - Popup functionality
- `content.js` - Content script (minimal)
- `js-deep-search-old.js` - Original monolithic implementation

## Installation

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable "Developer mode" in the top right
3. Click "Load unpacked" and select this directory
4. The Deep Search extension will appear in your extensions list

## Usage

1. Navigate to any web page
2. Click the Deep Search extension icon in the toolbar
3. Click "Activate Deep Search" in the popup
4. Use the search interface to explore JavaScript objects on the page

## Features

- Search in object keys, values, or both
- Partial or full match options
- Configurable search depth
- Export results as JSON or CSV
- Expand objects inline
- Copy values and paths to clipboard
- Filter results by type

## Refactoring Notes

This codebase was refactored from a single monolithic file (`js-deep-search-old.js`) into modular components for better maintainability and Chrome extension compatibility.