# EPUB Reader MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a static GitHub Pages EPUB reader for personal use in WeChat and normal browsers.

**Architecture:** A Vite React app loads a file chosen by the user with a file picker, renders supported local documents, and stores settings/progress locally. The app has no backend and is published by GitHub Actions to GitHub Pages using the `/pdf_compress/` base path.

**Tech Stack:** React, TypeScript, Vite, Vitest, Testing Library, epub.js, GitHub Actions, GitHub Pages.

---

## File Structure

- `package.json`: project scripts and dependencies.
- `vite.config.ts`: Vite, React plugin, Vitest config, and GitHub Pages base path.
- `src/main.tsx`: React entry point.
- `src/App.tsx`: top-level reader shell and state transitions.
- `src/components/FilePicker.tsx`: EPUB file selection UI.
- `src/components/Reader.tsx`: epub.js rendering surface and reading controls.
- `src/components/WechatNotice.tsx`: compatibility hint for WeChat browser.
- `src/lib/fileValidation.ts`: validates selected EPUB files.
- `src/lib/wechat.ts`: detects WeChat browser user agents.
- `src/lib/storage.ts`: persists settings and progress in local storage.
- `src/lib/*.test.ts`: tests for pure logic.
- `.github/workflows/deploy.yml`: builds and deploys to GitHub Pages.

---

### Task 1: Project Scaffold

**Files:**
- Create: `package.json`
- Create: `index.html`
- Create: `vite.config.ts`
- Create: `tsconfig.json`
- Create: `tsconfig.node.json`
- Create: `src/main.tsx`
- Create: `src/App.tsx`
- Create: `src/styles.css`

- [ ] **Step 1: Create the Vite React TypeScript project files**

Create the files listed above with a minimal app that renders the shell text `EPUB Reader`.

- [ ] **Step 2: Install dependencies**

Run: `npm install`

Expected: dependencies install without errors.

- [ ] **Step 3: Run the initial build**

Run: `npm run build`

Expected: Vite build exits with code 0 and writes `dist`.

- [ ] **Step 4: Commit**

Run:

```bash
git add .
git commit -m "chore: scaffold epub reader app"
```

### Task 2: Core Logic With TDD

**Files:**
- Create: `src/lib/fileValidation.ts`
- Create: `src/lib/fileValidation.test.ts`
- Create: `src/lib/wechat.ts`
- Create: `src/lib/wechat.test.ts`
- Create: `src/lib/storage.ts`
- Create: `src/lib/storage.test.ts`

- [ ] **Step 1: Write failing tests for EPUB validation**

Tests should assert that `.epub` files and `application/epub+zip` files are accepted, while PDFs and empty selections are rejected.

- [ ] **Step 2: Run validation tests and verify they fail**

Run: `npm test -- src/lib/fileValidation.test.ts --run`

Expected: fail because `validateEpubFile` is not implemented.

- [ ] **Step 3: Implement `validateEpubFile`**

Implement a pure function returning `{ ok: true }` or `{ ok: false, message: string }`.

- [ ] **Step 4: Run validation tests and verify they pass**

Run: `npm test -- src/lib/fileValidation.test.ts --run`

Expected: pass.

- [ ] **Step 5: Repeat red-green for WeChat detection and storage**

Run:

```bash
npm test -- src/lib/wechat.test.ts --run
npm test -- src/lib/storage.test.ts --run
```

Expected: each test fails before implementation and passes after implementation.

- [ ] **Step 6: Commit**

Run:

```bash
git add src/lib
git commit -m "test: cover reader browser utilities"
```

### Task 3: Reader UI

**Files:**
- Create: `src/components/FilePicker.tsx`
- Create: `src/components/Reader.tsx`
- Create: `src/components/WechatNotice.tsx`
- Modify: `src/App.tsx`
- Modify: `src/styles.css`

- [ ] **Step 1: Implement the file picker**

Use `<input type="file" accept=".epub,application/epub+zip,application/zip" />`, pass the selected file to the app, and show validation errors from `validateEpubFile`.

- [ ] **Step 2: Implement the epub.js reader surface**

Use `ePub(file)` to create a book, render into a ref container, wire previous/next controls, theme controls, font-size controls, and table-of-contents navigation.

- [ ] **Step 3: Persist progress and settings**

Use the storage helpers to save the current CFI, theme, and font size. Restore them when the same browser opens another session.

- [ ] **Step 4: Add WeChat compatibility notice**

Show a compact notice when the user agent looks like WeChat, explaining that file selection may need opening in the system browser.

- [ ] **Step 5: Run build**

Run: `npm run build`

Expected: build exits with code 0.

- [ ] **Step 6: Commit**

Run:

```bash
git add src
git commit -m "feat: add browser epub reader"
```

### Task 4: GitHub Pages Deployment

**Files:**
- Create: `.github/workflows/deploy.yml`
- Modify: `vite.config.ts`

- [ ] **Step 1: Configure GitHub Pages base path**

Set `base: "/pdf_compress/"` in `vite.config.ts`.

- [ ] **Step 2: Add GitHub Actions Pages workflow**

The workflow should install dependencies, run tests, build the app, upload `dist`, and deploy to Pages on pushes to the default branch.

- [ ] **Step 3: Run local verification**

Run:

```bash
npm test -- --run
npm run build
```

Expected: both commands exit with code 0.

- [ ] **Step 4: Commit and push**

Run:

```bash
git add .
git commit -m "ci: deploy reader to github pages"
git push
```

### Task 5: Final Verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Document usage**

Add the GitHub Pages URL pattern, local development command, and note that EPUB files stay in the browser.

- [ ] **Step 2: Run complete verification**

Run:

```bash
npm test -- --run
npm run build
git status --short
```

Expected: tests pass, build passes, and only intentional files are changed.

- [ ] **Step 3: Commit and push README**

Run:

```bash
git add README.md
git commit -m "docs: add reader usage notes"
git push
```
