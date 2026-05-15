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

// Back/forward navigation history for the PDF viewer.
//
// Ported from LaTeX-Workshop's `viewer/components/viewerhistory.ts`. The stack
// stores scroll positions of `#viewerContainer`; entries flagged `temporary`
// hold the position the user was at right before navigating away, so pressing
// "back" immediately after following a link returns to where they came from.

const MAX_ENTRIES = 30;

/** @type {{ scroll: number, temporary: boolean }[]} */
let history = [];
/** @type {number | undefined} */
let currentIndex;

function container() {
  return document.getElementById("viewerContainer");
}

/**
 * Record `scroll` as the current position. Truncates any forward history
 * (browser-style) and caps the stack at {@link MAX_ENTRIES}.
 */
export function set(scroll, force = false) {
  if (history.length === 0) {
    history.push({ scroll, temporary: false });
    currentIndex = 0;
    return;
  }

  if (currentIndex === undefined) {
    return;
  }

  const curScroll = history[currentIndex].scroll;
  if (curScroll !== scroll || force) {
    history = history.slice(0, currentIndex + 1);
    const last = history.at(-1);
    if (last) {
      last.temporary = false;
    }
    history.push({ scroll, temporary: false });
    if (history.length > MAX_ENTRIES) {
      history = history.slice(history.length - MAX_ENTRIES);
    }
    currentIndex = history.length - 1;
  }
}

/** Record the current `#viewerContainer` scroll position, if available. */
export function record() {
  const c = container();
  if (c) {
    set(c.scrollTop);
  }
}

export function back() {
  if (history.length === 0) {
    return;
  }
  const c = container();
  let cur = currentIndex;
  if (cur === undefined) {
    return;
  }
  let prevScroll = history[cur].scroll;
  if (prevScroll !== c.scrollTop && currentIndex === history.length - 1) {
    const last = history.at(-1);
    if (last.temporary) {
      last.scroll = c.scrollTop;
      cur -= 1;
      prevScroll = history[cur].scroll;
    } else {
      history.push({ scroll: c.scrollTop, temporary: true });
    }
  }
  if (prevScroll !== c.scrollTop) {
    currentIndex = cur;
    c.scrollTop = prevScroll;
  } else {
    if (cur === 0) {
      return;
    }
    const scroll = history[cur - 1].scroll;
    currentIndex = cur - 1;
    c.scrollTop = scroll;
  }
}

export function forward() {
  if (currentIndex === history.length - 1) {
    return;
  }
  const c = container();
  const cur = currentIndex;
  if (cur === undefined) {
    return;
  }
  const nextScroll = history[cur + 1].scroll;
  if (nextScroll !== c.scrollTop) {
    currentIndex = cur + 1;
    c.scrollTop = nextScroll;
  } else {
    if (cur >= history.length - 2) {
      return;
    }
    const scroll = history[cur + 2].scroll;
    currentIndex = cur + 2;
    c.scrollTop = scroll;
  }
}
