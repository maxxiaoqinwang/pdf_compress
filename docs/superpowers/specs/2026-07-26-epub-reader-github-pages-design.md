# EPUB Reader GitHub Pages Design

## Goal

Build a personal EPUB reader that runs as a static web app on GitHub Pages. The user opens the reader from a WeChat chat link, chooses an EPUB file in the browser, and reads it without storing a book library on the server.

## Scope

The first version supports ordinary reflowable EPUB files, including text, CSS, cover images, and inline images. It does not promise support for DRM-protected EPUBs, very large comic books, or complex fixed-layout textbooks.

The app is static-only. There is no backend, database, server-side upload, account system, or stored book library.

## Deployment

The app will be built as a Vite front-end project and deployed to GitHub Pages. GitHub Pages serves HTML, CSS, and JavaScript over HTTPS. The published URL can be sent to WeChat File Transfer Assistant or pinned in a chat.

For a repository named `epub-reader`, the default project URL will look like:

```text
https://<github-username>.github.io/epub-reader/
```

## User Flow

1. Open the GitHub Pages URL in WeChat.
2. Tap the file picker button.
3. Select an EPUB file from the phone's file picker.
4. The browser parses the EPUB locally.
5. The reader displays the table of contents and current chapter.
6. Reading progress and display preferences are saved locally in the browser.

If WeChat's built-in browser cannot select `.epub` files on a device, the app will show a fallback hint telling the user to open the same URL in the system browser.

## Mobile Reading UX

Mobile reading defaults to continuous vertical scrolling because it fits WeChat's browser and one-handed use better than paginated controls. Scroll mode must continue across EPUB spine items, so manga-style books can keep advancing by swiping down instead of stopping inside the current image page or chapter. The table of contents is not permanently visible on mobile; it opens as a bottom sheet. Primary controls sit in a fixed bottom toolbar with Chinese labels: contents, previous chapter/page, text settings, reading mode, theme, and next chapter/page.

The top reading chrome is compact. It shows only the current title and a return action, leaving the rest of the viewport for the book. Text settings open as a small panel for font size, line height, theme, and scroll/page mode.

## Architecture

The app contains these units:

- `FilePicker`: accepts a user-selected EPUB file and validates extension/type.
- `BookLoader`: opens the EPUB with `epub.js`.
- `ReaderView`: renders the book content and navigation.
- `Toolbar`: controls table of contents, font size, theme, and chapter navigation.
- `Storage`: persists progress and reader settings in browser storage.
- `WechatHint`: detects likely WeChat browser usage and shows compatibility guidance when needed.

EPUB images are resolved by the browser-side EPUB renderer from the selected file. No EPUB content is intentionally uploaded to any remote server.

## Data And Privacy

The GitHub Pages host only serves the application bundle. The user's EPUB file remains in the browser session unless the browser itself caches temporary data. Reading progress and settings are stored locally on the device.

Because the site is publicly reachable, the first version will not contain secrets, private books, API keys, or personal data in the repository.

## Error Handling

The app should handle these cases with clear messages:

- No file selected.
- Selected file is not an EPUB.
- EPUB cannot be opened or parsed.
- The book has no usable spine or table of contents.
- File selection appears unsupported in WeChat's browser.

## Testing

Before publishing, verify:

- Desktop browser can load a sample EPUB.
- Images inside an EPUB render correctly.
- Table of contents navigation works.
- Reading progress survives refresh.
- Production build works with the GitHub Pages base path.
- The published URL opens inside WeChat and reaches the file picker.
