# Separate Zalo auto-reply workflow

This is experimental integration plumbing, not a production-ready Zalo bot. Auto-reply remains disabled by default. Installing/publishing the n8n workflow does not enable Tikoder auto-reply or validate live inbox/sending behavior.

## Scope and protected workflow

- Export: `zalo-auto-reply.workflow.json`.
- Installer: `install-zalo-auto-reply.js` (Node.js with built-in `fetch`, Node 18+).
- New exact workflow name: **TikTokOrder - Zalo auto reply**.
- Production webhook: `POST http://127.0.0.1:5678/webhook/tikoder/zalo-auto-reply`.
- The existing active quote workflow `jzJwwSTD9yUgEgPr` is read-only to this installer. It is never updated, deactivated, activated, or executed. Do not use `configure-workflow.js` for this installation: that older script targets the quote workflow.
- Only Webhook 2.1, HTTP Request 4.4, IF 2, and Respond to Webhook 1.4 nodes are used. No Telegram, AI, Python, or custom Code nodes.

## Contract

1. Webhook requires Header Auth, Raw Body, and response mode `responseNode`. The export intentionally contains no credential IDs or secrets. The installer attaches only the existing quote webhook's `httpHeaderAuth` credential reference; it never fetches credential secrets or copies pinned data into the target.
2. **Inspect** posts the exact incoming binary field `data` to `http://127.0.0.1:3000/api/integrations/n8n/zalo-auto-reply/inspect`, with `Content-Type: application/json` and the original `x-tikoder-timestamp`, `x-tikoder-signature`, and `x-tikoder-event-id`. Do not parse/re-serialize the incoming body.
3. The IF reads the full HTTP response's `body.route`. Only `phone` or `qr` with a complete command (nonempty string `body`, `timestamp`, `signature`, `eventId`) reaches **Send Signed Command**. `review`, HTTP errors, or missing commands go directly to **Respond - Tikoder** with the inspect `statusCode` and `body` unchanged.
4. **Send Signed Command** posts to `/api/integrations/n8n/zalo-auto-reply/send` using raw `application/json`, body expression `$json.body.command.body`, and the three HMAC headers from `command.timestamp`, `command.signature`, and `command.eventId`. The command body is an EXACT JSON STRING signed by Tikoder with a different event type (`zalo.auto_reply_command`, not `zalo.auto_reply_requested`). Never stringify, edit, reconstruct, or substitute the original webhook body or original signature.
5. Both HTTP nodes use fullResponse, neverError, JSON response parsing, 8-second timeout, no redirects, no retry, and `onError: continueErrorOutput`. HTTP responses including 4xx/5xx pass their status/body through. Network/timeout/node errors use the error output and return a generic HTTP 503, without retry. If a response cannot be parsed as JSON, it also follows the node error path rather than inventing a successful response.
6. Send's status/body passes through **Respond - Tikoder**. HTTP 202 means accepted for processing, not sent or delivered. HTTP 503 means the outcome may be unknown; inspect Tikoder's queue before any manual retry. n8n execution success alone is not proof of delivery.

## Installation by the operator

The installer has not been run as part of adding these files. It must be run by the operator with a temporary local n8n API key.

1. **Restart the Tikoder server after the backend edits** so `/api/integrations/n8n/zalo-auto-reply/inspect` and `/send` are registered before the global JSON parser. Publishing n8n does not load backend code. Keep auto-reply disabled.
2. Confirm n8n is running on `127.0.0.1:5678` and Tikoder on `127.0.0.1:3000`. These loopback addresses assume the same host/network namespace; inside Docker, loopback is the container itself. Do not expose these callbacks publicly.
3. Supply a temporary n8n API key through **stdin only**, using a secure parent process or non-echoing secret-input mechanism. Never put the key in source, an environment variable, a file, a command-line argument, or shell history. From the repository root the command is:

   ```sh
   node integrations/n8n/install-zalo-auto-reply.js
   ```

   Stdin must contain just the key and then EOF. Interactive terminals may echo typed input; prefer the secure parent process. Revoke the temporary API key after use.
4. By default the installer makes only n8n management API requests. It paginates with `limit=100` and `nextCursor`, finds the exact target name, and aborts before writes if more than one exists. It creates when absent or updates the same target ID when present. Repeat runs preserve one target workflow and restore the desired structure, though n8n may issue a new version each time.
5. Before updating an existing target, it writes a configuration backup to `os.tmpdir()` using an exclusive filename and restrictive file mode where supported. It excludes `pinData` and does not log bodies. Backups include node configuration and credential references, so treat them as private and remove them after verification. File modes alone do not enforce Windows ACLs. Do not publish backups or n8n executions containing authentication headers.
6. API writes contain only `name`, `nodes`, `connections`, and writable settings `{ "executionOrder": "v1" }`. Read-only settings such as `binaryMode` and `availableInMCP` are never sent. The installer publishes via `POST /api/v1/workflows/:id/activate` with the saved `{versionId}`, then verifies active state, active version ID, nodes, connections, and the protected quote workflow's unchanged version/active state. It does not deactivate an active target first. Existing inactive targets are intentionally activated too. On failure after saving, inspect the target locally; there is no automatic rollback or retry.

### Optional rejection-only check

Opt in with:

```sh
node integrations/n8n/install-zalo-auto-reply.js --test-invalid-signature
```

Supply the API key via stdin as above. The installer can read an existing `x-tikoder-token` from the quote webhook's pinned test headers **in memory only**. If unavailable, it skips the check. It never writes or prints that token, pinData, request bodies, or response bodies.

The only submitted event has a deliberately invalid all-zero HMAC and an invalid event type. It cannot be a valid send command. The expected result is HTTP 401 with Tikoder's `Xác thực thất bại` error, distinguishing app rejection from n8n Header Auth rejection. HTTP 404 is recorded as **PENDING**, not an installation failure: restart Tikoder and check production webhook publication before rerunning. A 404 alone does not prove which service is missing the route. Other responses fail verification, not silently pass. For example, the backend's experimental-mode safety gate can return 403 before signature validation; do not weaken that gate just to pass a test.

No test sends a valid signed event, executes a workflow through the execution API, or submits a real Zalo message. Do not use pinned valid events or an editor's Execute Workflow action to test this installation.

## Remaining safety gates and limitations

- Keep the app's auto-reply switch off until an operator explicitly approves controlled live testing. This installer changes no app settings, templates, recipients, or secrets.
- The QR adapter has conditional observed-DOM support, not an authenticated upload contract. Inspect still returns review/unsupported unless image capability is explicitly true. A send is automatically marked `sent` only after a fresh matching echo, cleared draft/preview, and positive acceptance receipt; image confirmation additionally requires matching local bytes. Remote-only or transformed image echoes remain `needs_check`. The workflow must not bypass these gates.
- Inbox DOM behavior has only been exercised against fixtures, not validated against live Zalo Web. Stable inbound IDs, direction detection, baseline/history avoidance, exact recipient matching, and shared browser locking still require controlled live verification. Same-minute tail appends are now eligible, but previously unmounted history from that minute cannot be conclusively distinguished without a trusted arrival signal/server watermark. See `ZALO_AUTO_REPLY_PROGRESS_2026_10_26.md` before live use.
- Successful confirmed sends need no per-message approval. An uncertain event stays `needs_check` and cannot be replayed, but does not indefinitely block fresh events. Active `sending` serialization and per-rule cooldown remain enforced. No workflow change is required for this behavior.
- Tikoder owns HMAC verification, command event types, timestamp/replay checks, allowlists, revision checks, cooldowns, durable claim-before-send, and uncertain-outcome handling. n8n must not invent recipients, payment text, or QR payloads.
- Run one Tikoder process against the local data store. Zalo Web automation is unofficial and can lose sessions or risk account restrictions. No production-readiness or end-to-end live-delivery claim is made here.

## Offline validation

From the repository root:

```sh
node --check integrations/n8n/install-zalo-auto-reply.js
node -e "JSON.parse(require('node:fs').readFileSync('integrations/n8n/zalo-auto-reply.workflow.json', 'utf8')); console.log('Workflow JSON parses')"
```

These checks do not contact n8n, submit events, or validate the installed n8n runtime. Activation and any optional rejection result must be recorded by the operator after installation.
