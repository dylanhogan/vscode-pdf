/*
 * Copyright 2021 Mathematic, Inc.
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

import {
  back as historyBack,
  forward as historyForward,
  record as recordHistory,
} from "./history.mjs";
import { PDFViewerApplicationOptions } from "./pdf.js/web/viewer.mjs";

function loadConfig() {
  const elem = document.getElementById("pdf-view-config");
  if (elem) {
    return JSON.parse(elem.getAttribute("data-config"));
  }
  throw new Error("Could not load configuration.");
}

const config = loadConfig();

PDFViewerApplicationOptions.set("defaultUrl", "");
PDFViewerApplicationOptions.set("disablePreferences", true);
PDFViewerApplicationOptions.set(
  "defaultZoomValue",
  config.defaultZoomValue ?? "auto"
);
PDFViewerApplicationOptions.set(
  "sidebarViewOnLoad",
  config.sidebarViewOnLoad ?? 0
);

// Prevent pdf.js from intercepting Ctrl+P/Cmd+P and triggering the print dialog.
document.addEventListener(
  "keydown",
  (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "p") {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  },
  true
);

// Inject the back/forward toolbar buttons and wire up the navigation history.
// History entries are recorded around internal-link navigation so the user can
// jump back to where a link was followed from (and forward again).
function setupHistoryNavigation() {
  const app = window.PDFViewerApplication;

  // Record a baseline entry once the document is laid out.
  app.eventBus.on("pagesloaded", () => recordHistory());

  // Wrap the link-service navigation methods so that the position the user
  // navigated *from* is captured before the jump, and the destination is
  // captured once scrolling settles (so "forward" has a target).
  const linkService = app.pdfLinkService;
  for (const method of ["goToDestination", "goToPage", "setHash"]) {
    const original = linkService[method].bind(linkService);
    linkService[method] = (...args) => {
      recordHistory();
      const result = original(...args);
      Promise.resolve(result).finally(() => {
        setTimeout(() => recordHistory(), 400);
      });
      return result;
    };
  }

  // Toolbar buttons, inserted next to the page previous/next controls.
  const template = document.createElement("template");
  template.innerHTML = /* html */ `
    <div class="toolbarHorizontalGroup hiddenSmallView">
      <button class="toolbarButton" type="button" title="Go Back" id="historyBack" tabindex="0">
        <span>Back</span>
      </button>
      <div class="splitToolbarButtonSeparator"></div>
      <button class="toolbarButton" type="button" title="Go Forward" id="historyForward" tabindex="0">
        <span>Forward</span>
      </button>
    </div>
    <div class="toolbarButtonSpacer"></div>`;
  const pageNavGroup = document
    .getElementById("previous")
    ?.closest(".toolbarHorizontalGroup");
  if (pageNavGroup?.parentNode) {
    for (const node of [...template.content.childNodes]) {
      pageNavGroup.parentNode.insertBefore(node, pageNavGroup);
    }
  }
  document
    .getElementById("historyBack")
    ?.addEventListener("click", () => historyBack());
  document
    .getElementById("historyForward")
    ?.addEventListener("click", () => historyForward());

  // Keyboard: Alt/Cmd + Left/Right. Ignored while typing in a field.
  document.addEventListener("keydown", (e) => {
    const tag = document.activeElement?.tagName;
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") {
      return;
    }
    if (!(e.altKey || e.metaKey) || e.ctrlKey || e.shiftKey) {
      return;
    }
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      historyBack();
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      historyForward();
    }
  });

  // Mouse: dedicated back (button 3) / forward (button 4) buttons.
  window.addEventListener("mouseup", (e) => {
    if (e.button === 3) {
      e.preventDefault();
      historyBack();
    } else if (e.button === 4) {
      e.preventDefault();
      historyForward();
    }
  });
}

void (async () => {
  await window.PDFViewerApplication.initializedPromise;
  await window.PDFViewerApplication.open(config);
  setupHistoryNavigation();
  const [, hash] = config.url.split("#");
  if (hash) {
    window.PDFViewerApplication.pdfLinkService.setHash(
      decodeURIComponent(hash)
    );
  }
})();

window.addEventListener("message", async (event) => {
  await window.PDFViewerApplication.initializedPromise;
  const currentPageNumber =
    window.PDFViewerApplication.pdfViewer.currentPageNumber;
  switch (event.data.action) {
    case "reload":
      await window.PDFViewerApplication.open(config);
      await window.PDFViewerApplication.pdfViewer.pagesPromise;
      window.PDFViewerApplication.pdfViewer.currentPageNumber = Math.min(
        currentPageNumber,
        window.PDFViewerApplication.pdfViewer.pagesCount
      );
      break;
  }
});

window.addEventListener("error", (error) => {
  console.error(error);
});
