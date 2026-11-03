# Editing history orders without starting Live

The history modal's **Load đơn** action opens saved, merged, and legacy session orders in Orders immediately. Live is not required. The existing product UI and styling are retained.

## Orders workflow

- Use the existing customer/item controls to add, edit, or delete items and delete a customer's orders. **Thêm đơn khách** also adds a customer/order to an empty history.
- Every successful change is saved immediately to the selected history. Reloading reads those durable changes. The selected history ID (not customer data) is retained in account-scoped session storage for refreshes in the same browser tab.
- The notice identifies the selected history and provides **Tải lại lịch sử**, **Quay lại đơn hiện tại**, JSON export, and printing.
- Edits use `PATCH /api/live-sessions/:sessionId/orders` with an action and the revision returned by the detail API. The server resolves the selected record again, checks authorization and revision, validates the operation, and persists before returning the new revision. A stale request returns 409 rather than overwriting newer changes. Reload the history and retry after reviewing it.
- Saved/merged histories update only their own orders and summary. Source histories, ended run/segment snapshots, lifecycle timestamps, and merged source IDs remain intact. Legacy files are atomically replaced in their original owner/shared location, retaining stable item IDs and recalculating customer totals.
- Loading and editing never start, resume, or reopen Live. Only explicit Start opens a live run. No history is created by editing orders or creating quotes.
- An unrelated active Live runtime/history remains untouched, even when its broadcaster matches the selected history. If the selected record is itself the exact active history, its runtime is synchronized after persistence so later Live writes cannot restore the old orders. Concurrent Live changes invalidate the loaded revision; reload to review them.
- Incoming Live events do not replace the displayed history. Returning to current orders displays the latest Live data. Printing uses the displayed history in the browser, never the current Live thermal-printer handlers. JSON export also uses the displayed history; account-wide exports keep their original scope.
- The legacy `load-history-file` socket remains a compatibility read, never a live-runtime replacement. Its browser handler opens the corresponding authoritative history API record before editing or quoting.

## Quotes workflow

- Quotes has an independent **Tạo báo giá** form: select a saved customer, add/remove items, enter amounts and shipping notes, then save a draft. Add new customers in Customers first.
- **Tạo báo giá** on a history customer sends that history ID and revision. The backend reads items from that exact authorized history, not from active Live orders. A stale history is rejected. Current-order quoting retains its existing Live source.
- Existing quotes, including cancelled quotes, support adding/removing/editing items and editing shipping notes. Saving creates a new draft version. Previous versions are retained, and outstanding ready/queued/failed deliveries are cancelled. The changed draft requires fresh approval.
- **Xóa báo giá** requires confirmation and the displayed version. It cancels outstanding work and removes the quote while retaining delivery audit records. Confirmed sent/skipped deliveries are not resent or erased.
- PATCH, DELETE, approve and cancel require a matching quote version. Stale operations return 409. Reload Quotes to review the current version. Failed edits keep the editor's input intact.
- Quotes in `sending` or `needs_check` cannot be edited, cancelled, or deleted until the result has been checked. This prevents losing track of a message that may already have been sent. Use the existing sent/skipped resolution controls when available. Queued deliveries can be cancelled by editing/deleting before they are claimed.
- Existing consent, manual approval, experimental Zalo allowlist, and idempotency checks remain. One unresolved quote per customer is retained to avoid competing sends. Creating or editing a quote never sends it automatically.

## Authentication and storage limits

All APIs retain authenticated account isolation and the existing admin/owner visibility rules. History writes, like quote writes, require same-origin requests. UI access does not bypass another account's authorization. Standalone quotes can reference only a customer belonging to the authenticated account.

The JSON stores serialize synchronous mutations within the existing single Node process and use atomic replacement. They are not a distributed/multi-process transaction system; multiple independent writers to the same files are not supported. History revision checks cover the order snapshot, while unrelated record metadata is preserved from the current stored record.

## Validation

- `node --test scripts/testHistoryQuoteEditing.js`: temporary stores and a real Express/HTTP fixture with a test session shim. Covers standalone quote CRUD, versions, authentication/origin checks, cross-account history/quote sources, consent, queued cancellation, in-flight/unresolved delivery safety, cancelled-quote editing, delivery audit retention, saved/merged/legacy edits with no/matching/different active broadcaster, exact active synchronization, stale writes, persistence failures, admin/shared permissions, corrupt legacy files, and merged-source preservation. This is not a production login-provider test.
- `node scripts/testLiveSessionLifecycle.js`: temporary storage and mocked connectors. Retains lifecycle, offline legacy loading, ownership, failure rollback, and explicit Start invariants.
- `node --test scripts/testQuoteQueue.js scripts/testN8nZaloDispatch.js`: quote snapshots/versioning, consent, tenant isolation, approval idempotency, and identifier-only dispatch/claim safety.
- `node scripts/testDashboardResponsive.js`: installed `playwright-core`, real Microsoft Edge on Windows, intercepted fixture APIs. Covers standalone quote create/edit/delete, cancelled-quote controls, history CRUD and history-based quoting offline and alongside matching/different Live, refresh retention, failed loads, JSON export, browser printing, live-update isolation, returning to current orders, and the light/dark responsive matrix. Browser API fixtures validate UI wiring; the HTTP tests validate real backend persistence.

No production server, real TikTok/Zalo connection, customer records, or hardware printer is used by these tests. Existing queue tests create and clean up uniquely named test accounts; the new editing tests use temporary directories only.
