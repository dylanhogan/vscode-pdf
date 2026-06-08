/*
 * Copyright 2021 Mathematic Inc
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { join } from "node:path";
import {
  type CancellationToken,
  type CustomDocumentBackup,
  type CustomDocumentBackupContext,
  type CustomDocumentContentChangeEvent,
  type CustomEditorProvider,
  commands,
  type Disposable,
  EventEmitter,
  type ExtensionContext,
  Uri,
  type Webview,
  type WebviewPanel,
  window,
  workspace,
} from "vscode";

import rawViewerHtml from "../assets/pdf.js/web/viewer.html";

import { disposeAll } from "./disposable";
import { PDFDocument } from "./pdf-document";
import { escapeAttribute } from "./utils";
import { WebviewCollection } from "./webview-collection";

const viewerHtml = rawViewerHtml
  .replace(
    /* html */
    `<link rel="resource" type="application/l10n" href="locale/locale.json">`,
    ""
  )
  .replace(
    /* html */ `<script src="../build/pdf.mjs" type="module"></script>`,
    ""
  )
  .replace(/* html */ `<script src="viewer.mjs" type="module"></script>`, "")
  .replace(/* html */ `<link rel="stylesheet" href="viewer.css">`, "");

const vscodeWebviewUriPrefix = "https://file+.vscode-resource.vscode-cdn.net";

const resourcePathRegex = /\/[^/]+?\.\w+$/;

interface PendingBytesRequest {
  reject: (error: Error) => void;
  resolve: (bytes: Uint8Array) => void;
}

export class PDFViewerProvider implements CustomEditorProvider<PDFDocument> {
  static readonly viewType = "pdf.view";

  static register(context: ExtensionContext) {
    return window.registerCustomEditorProvider(
      PDFViewerProvider.viewType,
      new PDFViewerProvider(context),
      {
        supportsMultipleEditorsPerDocument: false,
        // Keep the pdf.js webview (and its in-memory annotation-editor state)
        // alive while the tab is hidden. Without this, switching tabs would
        // drop unsaved highlights/comments.
        webviewOptions: { retainContextWhenHidden: true },
      }
    );
  }

  private readonly webviews = new WebviewCollection();

  private readonly extensionRoot: Uri;

  /** Outstanding `getBytes` requests awaiting a webview reply. */
  private readonly pendingBytesRequests = new Map<
    string,
    PendingBytesRequest
  >();
  private nextRequestId = 0;

  private readonly _onDidChangeCustomDocument = new EventEmitter<
    CustomDocumentContentChangeEvent<PDFDocument>
  >();
  readonly onDidChangeCustomDocument = this._onDidChangeCustomDocument.event;

  constructor(context: ExtensionContext) {
    this.extensionRoot = Uri.file(context.extensionPath);
  }

  openCustomDocument(uri: Uri) {
    const document = new PDFDocument(uri);

    const listeners: Disposable[] = [];

    listeners.push(
      document.onDidChange((e) => {
        for (const webviewPanel of this.webviews.get(e)) {
          webviewPanel.webview.postMessage({ action: "reload" });
        }
      })
    );

    document.onDidDelete(() => disposeAll(listeners));

    return document;
  }

  private UriResolver(webview: Webview) {
    return (...paths: string[]): Uri =>
      webview.asWebviewUri(Uri.file(join(this.extensionRoot.path, ...paths)));
  }

  resolveCustomEditor(document: PDFDocument, webviewPanel: WebviewPanel): void {
    this.webviews.add(document.uri, webviewPanel);

    const resourceRoot = document.uri.with({
      path: document.uri.path.replace(resourcePathRegex, "/"),
    });
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [resourceRoot, this.extensionRoot],
    };

    webviewPanel.webview.html = this.getHtmlForWebview(
      document,
      webviewPanel.webview
    );

    webviewPanel.webview.onDidReceiveMessage((msg) => {
      this.handleWebviewMessage(document, msg);
    });
  }

  private handleWebviewMessage(
    document: PDFDocument,
    msg: { [key: string]: unknown }
  ): void {
    if ("open" in msg) {
      const urlWithCdnScheme = msg.open as string;
      const [file = "", hash] = urlWithCdnScheme
        .substring(vscodeWebviewUriPrefix.length)
        .split("#");
      commands.executeCommand(
        "vscode.open",
        Uri.file(file).with({ fragment: hash ?? "" })
      );
      return;
    }

    switch (msg.action) {
      case "contentChanged":
        this._onDidChangeCustomDocument.fire({ document });
        break;
      case "requestSave":
        commands.executeCommand("workbench.action.files.save");
        break;
      case "bytes": {
        const requestId = msg.requestId as string;
        const pending = this.pendingBytesRequests.get(requestId);
        if (!pending) {
          return;
        }
        this.pendingBytesRequests.delete(requestId);
        if (msg.error) {
          pending.reject(new Error(String(msg.error)));
        } else {
          pending.resolve(new Uint8Array(msg.data as ArrayBuffer | Uint8Array));
        }
        break;
      }
      default:
        break;
    }
  }

  /**
   * Ask the document's webview for the current annotated PDF bytes. Returns
   * the bytes pdf.js would emit from `pdfDocument.saveDocument()`.
   */
  private requestBytes(document: PDFDocument): Promise<Uint8Array> {
    const webviewPanel = this.firstWebviewFor(document.uri);
    if (!webviewPanel) {
      return Promise.reject(new Error("Cannot save: PDF viewer is not open."));
    }
    const requestId = String(++this.nextRequestId);
    const bytes = new Promise<Uint8Array>((resolve, reject) => {
      this.pendingBytesRequests.set(requestId, { resolve, reject });
    });
    webviewPanel.webview.postMessage({ action: "getBytes", requestId });
    return bytes;
  }

  private firstWebviewFor(uri: Uri): WebviewPanel | undefined {
    for (const panel of this.webviews.get(uri)) {
      return panel;
    }
    return;
  }

  async saveCustomDocument(
    document: PDFDocument,
    _cancellation: CancellationToken
  ): Promise<void> {
    const bytes = await this.requestBytes(document);
    document.suppressNextFileChange();
    await workspace.fs.writeFile(document.uri, bytes);
  }

  async saveCustomDocumentAs(
    document: PDFDocument,
    destination: Uri,
    _cancellation: CancellationToken
  ): Promise<void> {
    const bytes = await this.requestBytes(document);
    await workspace.fs.writeFile(destination, bytes);
  }

  revertCustomDocument(
    document: PDFDocument,
    _cancellation: CancellationToken
  ): Thenable<void> {
    for (const panel of this.webviews.get(document.uri)) {
      panel.webview.postMessage({ action: "reload" });
    }
    return Promise.resolve();
  }

  async backupCustomDocument(
    document: PDFDocument,
    context: CustomDocumentBackupContext,
    _cancellation: CancellationToken
  ): Promise<CustomDocumentBackup> {
    const bytes = await this.requestBytes(document);
    await workspace.fs.writeFile(context.destination, bytes);
    return {
      id: context.destination.toString(),
      delete: async () => {
        try {
          await workspace.fs.delete(context.destination);
        } catch {
          // Backup already gone — fine.
        }
      },
    };
  }

  private getHtmlForWebview(document: PDFDocument, webview: Webview): string {
    const resolveUri = this.UriResolver(webview);
    const resolveAssetURI = (...paths: string[]) =>
      resolveUri("assets", ...paths);
    const resolvePdfJsURI = (...paths: string[]) =>
      resolveUri("assets", "pdf.js", ...paths);

    const cspSource = webview.cspSource;

    const config = workspace.getConfiguration("pdf");
    const settings = {
      url: `${webview.asWebviewUri(document.uri)}`,
      docBaseUrl: `${webview.asWebviewUri(document.uri)}`,
      defaultZoomValue: config.get<string>("defaultZoomValue", "auto"),
      sidebarViewOnLoad: config.get<number>("sidebarViewOnLoad", 0),
    };

    return viewerHtml
      .replace(
        /* html */ "<title>PDF.js viewer</title>",
        /* html */
        `
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; connect-src ${cspSource}; script-src 'unsafe-inline' ${cspSource}; worker-src blob: ${cspSource}; style-src 'unsafe-inline' ${cspSource}; img-src * ${cspSource} data:;">
<meta id="pdf-view-config" data-config="${escapeAttribute(settings)}">

<title>PDF.js viewer</title>

<link rel="stylesheet" href="${resolvePdfJsURI("web", "viewer.css")}">
<link rel="stylesheet" href="${resolveAssetURI("main.css")}">

<script src="${resolvePdfJsURI("build", "pdf.mjs")}" type="module"></script>
<script src="${resolveAssetURI("main.mjs")}" type="module"></script>

<link rel="resource" type="application/l10n" href="${resolvePdfJsURI(
          "web",
          "locale",
          "locale.json"
        )}">`
      )
      .trim();
  }
}
