# EPUB Reader

A personal EPUB reader that runs as a static web app. Open the site in WeChat or a normal browser, choose an EPUB file, and read it locally in the browser.

## Privacy

The app does not include a backend, database, account system, or stored book library. EPUB files are selected by the user and parsed in the browser.

## Local Development

```bash
npm install
npm run dev
```

## Verify

```bash
npm test -- --run
npm run build
```

## GitHub Pages

The repository is configured for the GitHub Pages project URL:

```text
https://maxxiaoqinwang.github.io/epub_reader/
```

If the WeChat browser cannot choose an EPUB file on a device, open the same URL in the system browser from WeChat's top-right menu.
