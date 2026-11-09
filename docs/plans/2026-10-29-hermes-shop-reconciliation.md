# Hermes Shop Reconciliation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let Hoang ask `@shopAnhThu_bot` natural-language questions about Tikoder customers/latest orders, record live amounts, reconcile differences, and export Excel.

**Architecture:** `@shopAnhThu_bot` is the Hermes Telegram gateway, so do not implement another Telegram poller and do not modify `zalo-n8n-bot`. Add a local stdio MCP server inside Tikoder's Node repo; Hermes discovers its tools and exposes them to Telegram. The MCP server reuses Tikoder's customer/order-reading logic, returns minimal fields, and writes only a separate reconciliation ledger in Tikoder's `data/` directory. Tikoder's customer/order source data remains untouched.

**Tech Stack:** Node.js pinned to 26, existing Tikoder customer/live-session stores, Node built-in `node:sqlite` for the isolated ledger, `@modelcontextprotocol/sdk` (new), existing `exceljs`, Hermes native MCP client and Telegram gateway.

---

## Verified Context

- Telegram account: `@shopAnhThu_bot`, connected to Hermes Agent.
- `D:\Nho\project\zalo-n8n-bot` is a separate project and is not part of this feature.
- Tikoder root: `D:\Nho\Tikoder`.
- Tikoder's customer profiles are JSON under `data/customers`; active/saved live sessions are under `data/live-sessions`; legacy orders are under `history`.
- Tikoder currently exposes session-authenticated browser APIs, but there is no Telegram handler in this repo. Existing `buildOrdersDataset()` merges current-live, saved-session and legacy rows and sorts by timestamp; it includes phone fields in its general dataset, so the MCP lookup must construct an explicit minimal response.
- Tikoder already depends on `exceljs`; Node 26 provides built-in `node:sqlite`, so the ledger needs no additional SQLite package. Hermes's native MCP client supports local stdio servers and auto-injects discovered tools into platform toolsets.

## Product Rules / Defaults

- User asks in natural Vietnamese. Hermes may interpret language, but the MCP server exposes only narrow, typed operations; never expose arbitrary SQL, filesystem paths, shell execution, or arbitrary URLs as tools.
- “Đợt này” means the active live explicitly selected by the user. If none exists, ask which live; do not silently infer.
- The comparison target is one latest Tikoder order for the TikTok username, not a sum of orders. “Latest” is selected deterministically from the same timestamps/order sorting used by Tikoder. Persist the chosen order ID, amount, date/time, and source as a snapshot.
- One record per `(live_session_id, normalized_tiktok_username)`. A correction updates the current value while adding an audit revision.
- Difference = manually entered live amount minus snapshot amount. Missing customer/order/amount is “no comparison data”, never zero.
- Do not read or expose customer phone/address for this feature. Export only live name/time, TikTok username, display name, manual amount, latest order ID/time/amount, difference and status.
- Store only the ledger in a separate local SQLite file, e.g. `data/shop-reconciliation.sqlite3`; keep it covered by Tikoder's existing `.gitignore` rule for `data/`.
- No cloud upload or changes to Tikoder customer/order files.

## Task 1: Extract and Test a Shared Minimal Latest-Order Lookup

**Files:**
- Create: `utils/shopReconciliationData.js`
- Modify: `server.js` only if needed to call the shared helper without changing existing order API behavior
- Create: `scripts/testShopReconciliationData.js`

**Steps:**
1. Write failing tests for normalized TikTok username lookup, customer display name, newest order selection across current/saved/legacy sources, duplicate-order handling, tie-breaking, and no-result cases using synthetic fixtures.
2. Make the helper return an allowlisted object only: `username`, `displayName`, and optional nested `latestOrder` with `orderId`, `amount`, `orderedAt`, `source`. Add tests proving phone/address and unexpected fields cannot escape.
3. Reuse existing order-store/parsing code where possible. If logic must be moved from `server.js`, add regression tests asserting the existing `/api/orders` dataset remains unchanged for the same fixture.
4. Make malformed/unreadable history fail safely with a clear unavailable/no-result state; do not treat parse failure as a valid zero order.
5. Run focused test: `node --test scripts/testShopReconciliationData.js`; then run existing Tikoder `npm test` under Node 26.

## Task 2: Add a Separate SQLite Ledger

**Files:**
- Create: `utils/shopReconciliationStore.js`
- Create: `scripts/testShopReconciliationStore.js`

**Steps:**
1. Write failing tests for creating/selecting active live, writing first amount, updating same customer within one live, recording revisions, querying by username/live, persistence after reopen, and isolation across live sessions.
2. Use Node 26's built-in `node:sqlite`; create tables for `live_sessions`, `reconciliation_records`, `record_revisions`, and pending confirmation intents. Use integer VND values, normalized usernames, uniqueness `(live_id, username)`, timestamps, and foreign keys where feasible.
3. Make writes transactional. Store the Tikoder order snapshot on each accepted write; later Tikoder orders must not mutate old reconciliation rows.
4. Add expiring, one-time confirmation IDs for proposed writes. A prepare call creates a preview only; a confirm call commits exactly that pending preview once. Cancel/expiry creates no ledger change.
5. Run focused test: `node --test scripts/testShopReconciliationStore.js`.

## Task 3: Implement a Narrow Local MCP Server

**Files:**
- Create: `scripts/shopReconciliationMcp.js`
- Modify: `package.json` and `package-lock.json` to add the official MCP SDK
- Create: `scripts/testShopReconciliationMcp.js`

**Tools exposed to Hermes:**
- `lookup_customer_latest_order(username)` — read-only profile display name and latest single-order snapshot.
- `set_active_live(name)` — select/create the named active live.
- `prepare_live_amount(username, amount)` — validate and fetch snapshot from the active live context, create a preview/confirmation ID; no ledger write.
- `confirm_live_amount(confirmation_id)` — commit a previously previewed write once.
- `get_live_reconciliation(username?, live_name?)` — retrieve a customer's saved value or active-live records.
- `list_live_sessions()` — list saved live names and aggregate counts without customer-level data.
- `list_live_mismatches(live_name?)` — return only mismatches and missing-data cases, clearly distinguished.
- `export_live_reconciliation(live_name?)` — create a local `.xlsx` file in `data/exports/` with a sanitized timestamped name and return its filename/path.

**Steps:**
1. Write failing tests around each tool schema, input validation, least-privilege outputs, confirmation flow, and unknown-tool rejection.
2. Run as stdio MCP from Tikoder's repo using Node 26. Resolve the data root from the script location and bind to `TIKODER_SHOP_USER_ID`, or auto-detect only when the data tree contains exactly one shop profile; fail closed when ambiguous. Do not accept arbitrary filesystem paths or user IDs from model arguments.
3. Bind every lookup to the fixed shop profile selected by `TIKODER_SHOP_USER_ID` or the fail-closed single-profile detector. Use MCP tools for all data access; do not create a second Telegram poller.
4. Verify unauthenticated web clients cannot invoke these tools; stdio is launched as a local Hermes subprocess and is not exposed as a network listener.
5. Run: `node --test scripts/testShopReconciliationMcp.js` and a protocol smoke test that starts the server, discovers tools, and calls only synthetic fixtures.

## Task 4: Excel Export

**Files:**
- Create: `utils/shopReconciliationExcel.js`
- Create: `scripts/testShopReconciliationExcel.js`

**Steps:**
1. Test workbook sheet/headers, Vietnamese text, integer VND currency formatting, filters/frozen header, zero vs missing values, variance status, and absence of phone/address columns.
2. Use existing `exceljs`; write timestamped exports into the fixed `data/exports/` directory with sanitized names.
3. Validate workbook by reopening with ExcelJS and comparing rows to ledger source. Keep file attachment to Telegram as a separate enhancement if Hermes deliverable/Telegram upload behavior needs additional wiring; initial tool must always return an accurate local file path.
4. Run: `node --test scripts/testShopReconciliationExcel.js`.

## Task 5: Register MCP with Hermes and Validate Telegram Surface

**Files:**
- Modify: the active Hermes profile's `mcp_servers` configuration using Hermes CLI, not by hand-editing `config.yaml`.
- Update: Tikoder README / an integration document with setup and test instructions; never document tokens.

**Steps:**
1. Add the local stdio server entry under an unambiguous name (e.g. `shop_reconciliation`) pointing at `D:/Nho/Tikoder/scripts/shopReconciliationMcp.js`, using the configured Node 26 executable. Do not add credentials or customer data to the Hermes config.
2. Restart the Hermes gateway only after confirming impact and user approval; MCP server changes load at agent startup.
3. Confirm Hermes discovers the expected `mcp_shop_reconciliation_*` tools and they are available in the `@shopAnhThu_bot` Telegram session.
4. Test natural-language reads: “Tìm khách @fixture” and “@fixture đợt live test chốt bao nhiêu?”. Check tool output drives answer and the model does not invent fields.
5. Test write safety: “Ghi nhận @fixture 200k” must show a preview and ask confirmation; only a later explicit “xác nhận” commits. Test cancellation, timeout, duplicate intent and wrong chat.
6. Use synthetic fixture data only; verify no writes to `data/customers`, `data/live-sessions`, or `history`. Run all existing Tikoder tests plus every new focused test.

## Acceptance Criteria

- `@shopAnhThu_bot` can answer the supported natural Vietnamese customer/order/reconciliation questions using MCP data, not model memory.
- Hermes has no access to arbitrary SQL, arbitrary filesystem paths, or generic Tikoder write APIs through these tools.
- A proposed amount is previewed and requires explicit confirmation; cancellation/expiry writes nothing.
- The latest-order snapshot is the single latest Tikoder order and remains fixed in the ledger after newer orders appear.
- A separate local ledger stores manual amounts, corrections and revision history; Tikoder's customer/order sources remain unmodified.
- Excel opens successfully, matches the ledger, and contains no customer phone/address.
- Existing Tikoder UI, order API, and all current tests remain unchanged/passing.
- `zalo-n8n-bot` is not modified; no commit is made unless the user later asks.

## Not in Scope

- Creating a shared database or migrating Tikoder's JSON stores.
- Modifying `zalo-n8n-bot` or any n8n workflow.
- Automatic customer messaging, inventory/price management, Drive upload, or comparisons against sums of multiple orders.
