# Building & installing this fork locally

This fork adds back/forward navigation buttons to the PDF viewer toolbar. The
feature lives entirely in static assets:

- `assets/history.mjs` — scroll-position history stack
- `assets/main.mjs` — toolbar buttons, link hooks, keyboard/mouse bindings
- `assets/main.css` — back/forward button icons

Only `src/extension.ts` is bundled (by `tsup`) into `dist/extension.js`; the
`assets/*` files are shipped as-is, so most viewer changes don't even need a
rebuild — but packaging a `.vsix` does.

## Prerequisites

The repo expects `pnpm@10.31` and Node 24. If you only have npm and an older
Node, install pnpm into a user-local prefix (global needs root):

```bash
npm install -g --prefix "$HOME/.local" pnpm@10.31.0
export PATH="$HOME/.local/bin:$PATH"   # add to your shell profile to persist
pnpm install --frozen-lockfile
```

## Quick iteration (Extension Development Host)

For day-to-day development you don't need a `.vsix`:

1. Disable/uninstall the marketplace `mathematic.vscode-pdf` (it shares the same
   extension id and `pdf.view` custom-editor type, so they conflict).
2. Open this folder in VS Code and press **F5** ("Run Extension"). A new window
   launches running the fork from source.

Asset changes are picked up by reloading the dev-host window.

## Build and install as a permanent extension

```bash
export PATH="$HOME/.local/bin:$PATH"
pnpm run build
pnpm dlx @vscode/vsce@2.32.0 package --no-dependencies
code --install-extension vscode-pdf-<version>.vsix --force
```

Then run **Developer: Reload Window** in VS Code and reopen any PDF tabs.

### Versioning note

`package.json` `version` is intentionally kept ahead of the marketplace release
(e.g. `0.1.12` vs upstream `0.1.11`) so the locally installed `.vsix` outranks
the marketplace copy and isn't silently overwritten. Bump it again whenever
upstream catches up.

### Node 18 workaround

`vsce` (via `undici`) needs Node 20+'s global `File`. On Node 18, preload a
small polyfill — `vsce` only needs `File` to exist for `package`, not to work:

Create `tools/file-polyfill.cjs`:

```js
if (typeof globalThis.File === "undefined") {
  globalThis.File = class File extends Blob {
    constructor(parts, name, options = {}) {
      super(parts, options);
      this.name = String(name);
      this.lastModified = options.lastModified ?? Date.now();
    }
  };
}
```

Then run the package step with it preloaded:

```bash
NODE_OPTIONS="--require=$PWD/tools/file-polyfill.cjs" \
  pnpm dlx @vscode/vsce@2.32.0 package --no-dependencies
```

On Node 20+ this workaround (and the pinned `vsce@2.32.0`) is unnecessary —
`pnpm dlx @vscode/vsce package --no-dependencies` works directly.
