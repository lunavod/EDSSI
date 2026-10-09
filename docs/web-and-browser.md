# The assistant on the web

A plan for giving the assistant the web: searching it, reading pages, and driving a browser the
commander can see and step into. Built in the order below; each step is usable on its own.

## 1. Search and read (done)

- **`web_search`** is the Responses API's own hosted tool, added to the request when
  `assistant.web_search` is on. No search key; the provider bills it. Its `web_search_call` items
  are not sent back in later requests (nothing is stored, and they can't be replayed without their
  ids); the answer that cites them is.
- **`fetch_page`** (`toolsets/web.ts`, `web/fetch.ts`) fetches a URL in the main process and turns
  HTML into markdown, a window of it at a time (`offset`). Links are reduced to their text unless
  `links: true`, and images dropped, which roughly halves a Wikipedia article.
  - It says it is EDSSI. Claiming to be Chrome was tried and got refused by Inara, EDSM and
    Fandom, which serve the honest user agent.
  - Only `http`/`https`, and never a loopback, private or link-local address, checked again on
    every redirect.
  - Bodies are capped; plain text and JSON pass through; anything else is refused.
  - A page that refuses a plain fetch (403, a bot check) says so, so the model can hand it to the
    browser once there is one.
- Web content is untrusted: the toolset's instructions say never to follow instructions found on a
  page, and results carry the page's address so the model can say where something came from.

## 2. A browser the commander can see (done)

- `main/browser/browser.ts`: a `WebContentsView` laid over the **Browser** tab's frame (the tab
  reports its rectangle over IPC; the main process scales it by the window's zoom), hidden while
  another tab is up. One page, no tabs: a link that opens a window opens in place.
  - Its own `persist:browser` session, so sign-ins survive restarts apart from EDSSI's pages. No
    preload, sandboxed, context isolation. Every permission refused, downloads cancelled, and no
    request to `localhost` or a private address written as an IP.
  - The address bar takes an address or words to search for (DuckDuckGo). Model-given addresses go
    through the same `publicUrl` check as `fetch_page`.
- Tools (`toolsets/browser.ts`): `browser_open(url, show)`, `browser_back`, `browser_read`
  (an outline, windowed like `fetch_page`) and `browser_screenshot`. The open page is in the brief.
- **The outline** (`ax-tree.ts`) is `Accessibility.getFullAXTree` over `webContents.debugger`,
  folded: unnamed wrappers and lists vanish, text runs join, a table row is one `a | b` line, and
  everything usable carries `[ref=N]` (its backend DOM node id, for step 3's clicks).
- **Screenshots** are `capturePage()` JPEGs scaled to 1280 wide, passed back as `input_image`
  through `ToolResultWithImages`. They are dropped from the history once the question is
  answered. Found by trying it in Electron 44 (a scratch harness, not unit tests):
  - A view sized _after_ `setVisible(false)` captures as an empty image, so size comes first.
  - A hidden view never gets a surface for the first document it loads, so a new view loads
    `about:blank` first. Later navigations capture after one retry ~250 ms on.
  - `Page.captureScreenshot` over the protocol hangs on hidden views after the first capture.
- Checked in the running app over remote debugging: the page sits exactly over the frame, hides
  on another tab and comes back. Loading, the outline and screenshots were run against Spansh,
  the Frontier forums (which refuse `fetch_page` but load here), Wikipedia and Inara.

## 3. Acting on pages, and asking for help (done)

- **Actions** (`main/browser/actions.ts`, over the DevTools protocol): `browser_click(ref)` sends
  real mouse events at the element's centre; `browser_type(ref, text, submit)` selects the field's
  contents and inserts the text, or picks a select's option; `browser_press(key)`;
  `browser_scroll(direction)`; `browser_eval(script, purpose)` in the page's own world. Elements
  are described from an isolated world, so the page's scripts can't change what the checks see.
- **What a hidden view needs** (Electron 44, found with scratch harnesses): without
  `Emulation.setFocusEmulationEnabled` clicks and keys are dropped or held back, so it is turned on
  whenever the protocol attaches. A wheel event never scrolls a hidden view and can hang, so
  scrolling is done by script (the page, or the scrolling box in the middle of the screen). Every
  input event has a 5 s limit.
- **The gate** (`toolsets/browser-risk.ts`, pure): asks before clicking a form's submit button
  (unless the form only fetches: a search, or `method="get"`), a button whose label commits
  (buy, send, post, delete, sign in, …), a link that buys, deletes or signs out, pressing Enter in
  such a form, and before every script. It refuses outright to type into password, payment or
  one-time-code fields, and tells the model to ask the commander instead.
- **Asking** (`ai/service.ts`): tools call `askCommander` on their context. The prompt goes into
  the assistant snapshot and shows as a bar in the Browser and Comms tabs (Allow / Deny, or Done /
  Give up). It is read out when speech is on, and the window flashes in the taskbar rather than
  taking focus from the game. A typed or spoken "yes", "no", "done" or "give up" answers it
  (`interpretReply` in `shared/prompts.ts`); anything else is a new question, which cancels the
  one waiting. With no `askCommander` (tests, scripts) anything that needs a yes is refused.
- **`request_commander_help(reason)`** opens the Browser tab and waits up to 15 minutes; gated
  tools may wait 3. Tools declare their own `timeoutMs`.
- Checked end to end in the dev app, with EDSSI's `base_url` pointed at a local fake of the
  Responses API that played a script: open httpbin's form, read it, type and submit (the prompt
  came up; Allow submitted it, and "no" typed as a reply left it unsubmitted), and a help request
  answered by typing "done". Stop while a prompt waits clears it.

## Open questions

- Whether the ChatGPT (codex) backend accepts hosted `web_search`; see `docs/unverified.md`.
- Game sites with APIs (Spansh, Inara, Canonn) are better as their own tools than via the browser.
