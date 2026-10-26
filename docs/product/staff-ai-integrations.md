# AI integrations

- **Status:** Current
- **App and route:** staff-web, `/ai-integrations` (section `aiIntegrations`, sidebar **AI integrations** in the **Governance** group, Platform Admin only)
- **Owner:** @nielpattin
- **Last reviewed:** 2026-10-26

Tags: `[observed]` a code fact read on 2026-10-26; `[standard]` a decision from industry practice, listed under Decisions; `[owner]` a recorded owner decision (none on this page yet). See [README](README.md).

## Purpose

- `[observed]` A Platform Admin sets the provider, model, base URL and API key of each of the four AI features, and sees whether each one uses a saved key or the server environment.
- `[observed]` The page's description: "Provider, model, and API key for the AI features. A saved key is encrypted and never shown again."
- `[standard]` A key or provider can change without a redeploy, and one Platform Admin can fix an outage without access to the servers. Why the settings live in the database: Decision 9.

## Users and entry points

- `[observed]` Platform Admin only. `apps/staff-web/src/App.tsx` sets `aiIntegrations: ["Platform Admin"]`, so other roles do not see the item.
- `[observed]` The four credential routes answer `403` "Platform admin access required" to any other signed-in account. Rule: [BR-AUTH-007](../business-rules.md).
- `[standard]` Customers and signed-out visitors have no access to any AI setting.
- `[observed]` Entry: the sidebar item or `/ai-integrations`. Ctrl/Cmd+S saves the form that holds focus (label **Save**).
- `[standard]` The shopping assistant, which these settings power, needs a signed-in customer (Decision 20; gap G13).

## User stories and acceptance criteria

### US1. As a Platform Admin, I save the provider, model, base URL and API key of one AI feature, so that the feature works without a redeploy

- Source: `[observed]` for the form; the limits and hints are `[standard]` (Decisions 3, 13, 17).
- Accepted when:
  - The page shows four cards in this order: **Shopping assistant**, **Prescription photo reading**, **Semantic product search**, **Question screening**.
  - Each card has **Provider** (only the providers the server lists for that feature), **Model**, **Base URL**, **API key** (a password field) and **Lưu cài đặt** (Save settings).
  - **Lưu cài đặt** is enabled only when the model is 1 to 128 characters; the base URL starts with `https://` and is at most 512 characters; and either a key of 8 to 512 characters is typed or the saved key is kept (same provider). When it is disabled, the form says which field is missing (gap G11).
  - A successful save shows "Đã lưu cài đặt.", the card shows source "Khóa đã lưu", and the key field is empty.
  - Choosing a provider moves the base URL to that provider's default, unless the admin has typed a base URL.
  - A typed key over a saved key opens "Thay khóa API?". "Thay khóa" stays disabled until the last four characters of the current key are typed. Cancelling sends nothing.
  - Leaving the page with unsaved edits asks "Your changes have not been saved."
  - A refused save keeps the typed values and shows the Vietnamese text for its error code (Decision 17; gap G8).
  - **Question screening** starts with model `jev-latest` when nothing is saved, and the admin may change it (Decision 13; gap G6).

### US2. As a Platform Admin, I see what each feature uses, without seeing its key

- Source: `[observed]`.
- Accepted when:
  - A saved card lists **Provider**, **Model**, **Base URL**, **Key ending in** (last four characters), **Updated** and **Updated by** (the display name or email, else "Tài khoản không xác định"). **Updated** is shown in Asia/Ho_Chi_Minh (gap G10).
  - An environment card shows source "Khóa từ môi trường" with its server-environment note, no **Updated** rows and no **Remove key** button.
  - A feature with nothing set shows "Chưa cấu hình" and its "without a key" text.
  - No response, page source or form field holds the full key. The key field is empty on load.

### US3. As a Platform Admin, I remove a saved key, so that the feature falls back to the environment or stops

- Source: `[observed]`; the audit entry is `[standard]` (Decisions 14, 15).
- Accepted when:
  - "Xóa khóa" appears only on a card with a saved key. Its dialog asks for the last four characters and says the feature goes back to the environment key when one is set, or stops working until a new key is saved.
  - Confirming shows "Đã xóa khóa API." and the card shows "Khóa từ môi trường" or "Chưa cấu hình", as the environment decides.
  - The removal writes an audit entry (gap G2).
  - The page never edits `.env`.

### US4. As a Platform Admin, I test a key before I save it, so that a bad key shows up before customers meet it

- Source: `[standard]` (Decision 6).
- Accepted when:
  - Each form has **Kiểm tra kết nối**. It sends one minimal request to the provider, with the typed key or, when the provider is unchanged, the saved key. It shows "Kết nối thành công." or a Vietnamese reason: the key was refused, the provider could not be reached, or the provider returned an error.
  - The test saves nothing, and the card is the same after it.
  - A failed test does not block **Lưu cài đặt**.
  - The key never appears in the result, the page or the logs (gap G7).

### US5. As a Platform Admin, I see when a status cannot be loaded, so that I do not mistake it for an unconfigured feature

- Source: `[observed]`.
- Accepted when:
  - A failed status request shows the "Không khả dụng" badge and "Không tải được trạng thái của khóa này.", with no form. The other cards still load.
  - While loading, four skeleton cards show, with "Đang tải tích hợp AI..." for screen readers.

### US6. As a Platform Admin, I am warned that semantic search does not read the key saved here

- Source: `[standard]` (Decision 11).
- Accepted when:
  - While a search key is saved here, the **Semantic product search** card says that search reads its `AI_EMBEDDING_*` settings from the server, not this key, and that the two sets must be equal (gap G5).
  - The warning is removed once search reads the saved settings.

## Contents and behavior

`[observed]` unless marked.

1. The page description (above).
2. Four cards in a responsive grid. Each card has a title, a one-line description, a source badge, the status list and the form.
3. The cards (titles and descriptions as in `apps/staff-web/src/i18n/governance.ts`):

| Card | Vietnamese title and description | Route | Without a key |
| --- | --- | --- | --- |
| Shopping assistant | "Trợ lý tư vấn": answers shopper questions on the customer website | `/api/chatbot/credential` | "Không có khóa, trợ lý không thể trả lời." |
| Prescription photo reading | "Đọc ảnh đơn thuốc": reads the medicines from a photo of a printed prescription | `/api/prescriptions/intake-credential` | Photo reading is off; QR intake still works |
| Semantic product search | "Tìm kiếm sản phẩm theo ngữ nghĩa": finds products by meaning | `/api/products/search-credential` | Search matches keywords only |
| Question screening | "Sàng lọc câu hỏi": checks each question first; greetings, off-topic, emergency and injection questions get a fixed reply | `/api/chatbot/intent-gate-credential` | The assistant answers `503 assistant_unavailable` (Decision 12) |

4. Providers offered (the server's list, `[observed]`, matching [BR-CRED-003](../business-rules.md)):

| Feature | Providers | Default base URL |
| --- | --- | --- |
| Shopping assistant | Google Gemini (`gemini`); OpenAI-compatible (`openai-compatible`) | `https://generativelanguage.googleapis.com`; `https://api.openai.com/v1` |
| Question screening | TypeSafe Jev (`typesafe`) | `https://api.typesafe.ai` |
| Prescription photo reading | Google Gemini only | `https://generativelanguage.googleapis.com` |
| Semantic product search | Gemini and OpenAI-compatible today; OpenAI-compatible only after Decision 10 | `https://api.openai.com/v1` for OpenAI-compatible |

   The key hint follows the provider: Gemini "Dán khóa từ Google AI Studio. Khóa được mã hóa khi lưu."; OpenAI-compatible asks for a base URL that carries the version path (for example `https://llm.example.com/v1`); TypeSafe "Dán khóa từ TypeSafe. Khóa được mã hóa khi lưu."; other providers get a generic hint.

5. Where the settings live (`[observed]`, [ADR 0009](../adr/0009-ai-feature-settings-in-database.md)):

| Feature | Owning service and table | Purpose key | Environment prefix |
| --- | --- | --- | --- |
| Shopping assistant | chatbot-service, `ai_credentials` (migration `0001`) | `chatbot` | `AI_CHATBOT_*` |
| Question screening | chatbot-service, same table | `intent-gate` | `AI_INTENT_GATE_*` |
| Prescription photo reading | sales-service, `ai_credentials` (migration `0006`) | `prescription-reader` | `AI_PRESCRIPTION_READER_*` |
| Semantic product search | catalog-service, `ai_credentials` (migration `0008`) | `embedding` | `AI_EMBEDDING_*` |

   - Keys are sealed with AES-256-GCM under `SECRETS_ENCRYPTION_KEY` ([BR-CRED-001](../business-rules.md)). The API returns only the last four characters.
   - Saved settings replace the environment group as a whole and are never merged. Each process caches them for 60 seconds ([BR-CRED-005](../business-rules.md), [BR-CRED-006](../business-rules.md)): a change applies at once on the instance that saved it and within 60 seconds on the others.
   - Search-service has no database. It reads only its own `AI_EMBEDDING_*` group, which must equal catalog-service's ([runbook](../runbook.md#self-hosted-product-search-embeddings)).
   - Only a save or removal of the search key starts a catalog reindex (Decision 2).

6. What happens without settings (`[observed]` unless marked):
   - Shopping assistant: `503 assistant_unavailable`; the widget shows "Trợ lý tư vấn đang gặp sự cố. Vui lòng thử lại sau ít phút." ([user guide](../user-guide.md#ai-integrations)).
   - Question screening: with no screening key the gate refuses the question, so the assistant answers `503 assistant_unavailable` and no question reaches the model unscreened (`[observed]`, `ConfiguredIntentGate`; Decision 12).
   - Prescription photo reading: `503 reader_unavailable`; the intake page says "Tính năng đọc đơn thuốc từ ảnh chưa được bật." and QR intake still works.
   - Semantic product search: keyword only. Queries of fewer than three words are always keyword only (`SemanticMinWords = 3`; Decision 8).

## States

- `[observed]` Loading: four skeletons and screen-reader text (US5).
- `[observed]` Status failed: that card shows "Không khả dụng" and no form (US5).
- `[observed]` Not configured: "Chưa cấu hình", the "without a key" text, and an empty form on the first provider.
- `[observed]` Saved or environment: values and source (US2).
- `[observed]` Save or removal refused: the form keeps the typed values. Today the server's English title is shown; target is the Vietnamese text for the error code (Decision 17; gap G8).
- `[standard]` Testing (US4): the test button shows a busy state, and the result stays under the form until the next test.
- `[observed]` Unsaved edits: leaving asks "Your changes have not been saved."
- `[observed]` A 401 on any request ends the session: the notice "Phiên đã hết hạn. Vui lòng đăng nhập lại." appears, the user signs in, and returns to this page (Decision 18).

## Out of scope

- Editing `.env` or the `AI_*` variables; those are server settings.
- Showing, copying or exporting a saved key. A key is write-only.
- Usage, quota or cost figures, and provider health monitoring beyond the on-demand test in US4.
- Per-user or per-site keys.
- Automatic key rotation and expiry reminders.
- Viewing audit entries ([users and audit](staff-users-and-audit.md)).
- Search-service settings beyond the warning in US6; Decision 11 owns that change.

## Rules and designs

- [BR-AUTH-007](../business-rules.md): AI settings are Platform Admin only. [BR-AUTH-002](../business-rules.md): route roles.
- [BR-CRED-001](../business-rules.md) to [BR-CRED-006](../business-rules.md): sealing, masked status, providers per feature, save checks, stored settings over the environment, cache.
- [BR-CHAT-001](../business-rules.md), [BR-CHAT-005](../business-rules.md), [BR-CHAT-007](../business-rules.md), [BR-CHAT-008](../business-rules.md): the assistant and its screening gate.
- [BR-AUDIT-002](../business-rules.md) to [BR-AUDIT-004](../business-rules.md): audit fields, filters, Platform Admin only.
- [ADR 0002](../adr/0002-service-owned-databases.md), [ADR 0009](../adr/0009-ai-feature-settings-in-database.md), [ADR 0010](../adr/0010-fail-fast-environment-configuration.md).
- [API guide, AI integration keys](../api-guide.md#ai-integration-keys), [user guide, AI integrations](../user-guide.md#ai-integrations), [runbook, self-hosted embeddings](../runbook.md#self-hosted-product-search-embeddings).
- [Shell and sign-in](staff-shell-sign-in-and-navigation.md) (session, Decision 18); [customer shopping assistant](customer-shopping-assistant.md) (Decision 20).

## Decisions

| # | Question | Decision | Why |
| --- | --- | --- | --- |
| 1 | Why are the four features configured in staff-web and not only in `.env`? | [standard] Keep them in staff-web, Platform Admin only. `.env` stays as the deployment fallback (BR-CRED-005). | An admin rotates a key or changes provider without a redeploy or server access, and every change is audited. ADR 0009 records no further reason; this is the reason adopted. |
| 2 | Does saving any key start a reindex? The user guide says yes; ADR 0009 says only search. | [standard] Only saving or removing the **search** key starts a catalog reindex. The chat, screening and photo keys start none. The user guide must say the same. | The embedding model name is part of the product content hash (runbook), so a model change must re-embed. The other features read their settings per request and have no index. |
| 3 | Do the server's length limits apply, and should the page show them? | [standard] Yes. The server rule is the rule: model 1 to 128 characters; base URL `https://`, at most 512; key 8 to 512 (BR-CRED-004). The page applies the same limits, shows them in the hints and says why **Lưu cài đặt** is disabled. | One rule, shown before the round trip, so a refused save is not the first place the admin learns it. |
| 4 | Is the provider list authoritative? BR-CRED-003 and the page could disagree. | [standard] The `providers` list the server returns for each feature is the only list the page offers. It must equal BR-CRED-003 and the API guide. Today chat, screening and photo match; search changes under Decision 10. | One list stops the page offering a provider the service cannot run. |
| 5 | Should a saved provider that the feature lacks be refused at save time? | [standard] Yes, and the API already does: the PUT refuses it with `400 invalid_request` through a per-feature `z.enum`. A row written outside the API that no longer fits still answers 503 on first use, and a new save fixes it. ADR 0009 is corrected (G12). | Fail fast at the boundary (ADR 0010). |
| 6 | Is a live check wanted before a save takes effect? | [standard] Yes: **Kiểm tra kết nối** (US4). It makes one minimal call with the typed or kept key and saves nothing. A failed test does not block the save. Owner may change: each test call is billed by the provider. | A bad key otherwise appears first as a customer's 503. Validating a credential before use is common practice. |
| 7 | Which schema applies to which service? ADR 0009 cites only the catalog migration. | [standard] Each owning service keeps its own `ai_credentials` table in its own database: catalog `0008`, chatbot `0001`, sales `0006`. ADR 0009 is corrected (G12). | Service-owned databases (ADR 0002); the code already works this way. |
| 8 | Does the three-word search rule belong on this page? | [standard] No. The rule (`SemanticMinWords = 3`, runbook) is search behaviour. This page configures the key only, and the card text stays as it is. | Short queries are the ones shoppers repeat, and the keyword fields cover them. Embedding them costs more and returns noisier hits (runbook). |
| 9 | Why store the settings in the database, beyond the redeploy point in ADR 0009? | [standard] Keep the database. Each owning service reads its own row per purpose, with the key sealed (BR-CRED-001). The environment group stays as the fallback. | Rotation without redeploy, changes per feature, and no live key in the deploy configuration. Search-service is the exception (Decision 11). |
| 10 | Which embedding providers may product search use? | [standard] `openai-compatible` only, until search-service can serve another provider. Gemini leaves the embedding list (G4). | Query and product vectors must come from one model (runbook: do not mix models). Search-service embeds queries with `openai-compatible` only and stops at startup on any other value (`config.go`). A saved Gemini key would index with one model and search with another. |
| 11 | Does search-service use the saved settings? | [standard] Target: search-service reads the saved embedding settings from catalog-service, so there is one source. Until then the search card shows the warning in US6. | Today saved settings reach only catalog-service, so the two sides silently split and return odd hits (ADR 0009, Consequences). |
| 12 | What happens when the screening key is missing? | [standard] The assistant does not answer: `503 assistant_unavailable`, and the card says so. The screen is not skipped. Owner may change: this takes the assistant offline while the screening key is missing. | Screening is the only check before the model for emergencies and prompt injection (BR-CHAT-005). The prompt rules (BR-CHAT-007) are not hard checks. A missing safety control must fail visibly. |
| 13 | Is the screening model prefilled? | [standard] Yes: `jev-latest` when nothing is saved; the admin may change it. | The card already names it as the default. A prefilled required field removes a typing error. |
| 14 | What does Remove key do to the stored key? | [standard] It deletes the sealed key. No soft delete and no reveal. The removal is audited (Decision 15). | Deactivate, never hard-delete, applies to reference data in use. A secret no longer used should not stay sealed (least privilege). |
| 15 | Is every save and removal audited? | [standard] Yes, for all four keys: actor, feature, provider and model. Never the key or its last four characters. | Every change to a credential is audited. Logs never carry secrets (OWASP Logging Cheat Sheet). Catalog already does this for the search key (`audit-rules.ts`). |
| 16 | Does a second person approve a key change? | [standard] No. Segregation of duties does not apply, because nothing here is approved. The audit trail (Decision 15) and the Platform Admin role are the controls. Owner may change: two-person control on keys is a policy choice. | A key outage must be fixable at once by one admin, and the audit trail gives the review afterwards. |
| 17 | How are save and removal errors shown? | [standard] In Vietnamese, chosen by the error `code` (`invalid_request`, `api_key_required`, `forbidden`), with a generic line for any other code that names the field to fix. No English title is shown. | Staff work in Vietnamese, and a raw English title is not actionable for them. |
| 18 | What does a 401 do on this page? | [standard] It ends the session visibly: the notice "Phiên đã hết hạn. Vui lòng đăng nhập lại.", then sign-in, then a return to this page. | The same session rule applies to every staff page. |
| 19 | Which time zone is "Updated" in? | [standard] Asia/Ho_Chi_Minh. | Dates and "today" use the business time zone for every user. |
| 20 | Can a shopper use the assistant without signing in? | [standard] No. The assistant needs a signed-in customer (BR-CHAT-001). The user guide is corrected (G13). | Only a signed-in customer opens a chat session, and each session belongs to one customer (BR-CHAT-002). |

## Gaps against the code (2026-10-26)

| ID | The spec requires | The code does today | Where |
| --- | --- | --- | --- |
| G2 | Every save and removal of all four keys is audited with actor, feature, provider and model, never the key (Decision 15). | Only catalog-service audits (`catalog.ai-credential.replaced` and `.cleared`, details `provider` and `model`). chatbot-service and sales-service write no audit entry for their three routes. The user guide's Audit section lists AI credentials under Catalog only. The code is wrong; the user guide must name all four routes. | `apps/catalog-service/src/modules/audit/audit-rules.ts`; `apps/chatbot-service/src/main.ts`; `apps/sales-service/src/main.ts`; `docs/user-guide.md`, "Audit log" |
| G4 | Product search offers `openai-compatible` only (Decision 10). | catalog-service accepts and lists `gemini` and `openai-compatible`. BR-CRED-003 lists `gemini` for embedding; the API guide says the search route accepts both; the runbook's "To use Gemini instead" paragraph tells the admin to switch to Gemini. Code, BR-CRED-003, API guide and runbook must change together. | `apps/catalog-service/src/contracts/credentials.ts`; `docs/business-rules.md` BR-CRED-003; `docs/api-guide.md`, "AI integration keys"; `docs/runbook.md`, "Self-hosted product search embeddings" |
| G5 | Search-service uses the saved embedding settings, or the US6 warning shows until it does (Decision 11). | Search-service reads only its own `AI_EMBEDDING_*` environment, and the card shows no warning. The runbook says saved settings live only in catalog-service's database, which is true today. The code is behind the target. | `apps/search-service/internal/config/config.go`; `apps/staff-web/src/sections/ai-integrations/credential-card.tsx` |
| G6 | Question screening starts with `jev-latest` (Decision 13). | Only a hint "Mô hình mặc định: jev-latest" shows. `initialFormState` leaves the model empty. | `apps/staff-web/src/sections/ai-integrations/features.ts` (`defaultModel`); `apps/staff-web/src/sections/ai-integrations/credential-form.ts` |
| G7 | A **Kiểm tra kết nối** action that tests without saving (Decision 6). | No such control and no test route. The routes are GET, PUT and DELETE only. | `apps/chatbot-service/src/modules/credentials/credential-routes.ts`; `apps/catalog-service/src/modules/credentials/credential-routes.ts`; `apps/sales-service/src/modules/credentials/credential-routes.ts` |
| G8 | Save and removal errors in Vietnamese, chosen by code (Decision 17). | `ApiProblemError` takes `detail` or `title`, and the toast shows it through `translateText`. `Invalid request` has a Vietnamese entry (`sales.ts`). `An API key is required` has none, and `Platform admin access required` (403) does not match `Platform Admin access required.` (`governance.ts`), so the admin sees English. | `apps/staff-web/src/staff-api.ts`; `apps/staff-web/src/hooks/useStaffAction.ts`; `apps/staff-web/src/i18n/governance.ts` |
| G10 | "Updated" is shown in Asia/Ho_Chi_Minh (Decision 19). | `formatDateTime` builds its formatter without a `timeZone`, so the browser's zone is used. | `apps/staff-web/src/staff-api.ts` (`createFormatters`, `formatDateTime`) |
| G11 | The page enforces the server's limits and says why **Lưu cài đặt** is disabled (Decision 3). | Only the blank model, the `https://` prefix and the 8-character key minimum are checked. Inputs have no length limit, and a disabled button gives no reason. The server enforces the limits. | `apps/staff-web/src/sections/ai-integrations/credential-form.ts` (`canSaveForm`); `apps/staff-web/src/sections/ai-integrations/credential-card.tsx`; `apps/chatbot-service/src/contracts/credentials.ts` |
| G12 | ADR 0009 says a saved provider the feature lacks is refused at save time, and that each service owns its table (Decisions 5, 7). | ADR 0009 says a saved unsupported provider "passes startup and fails on first use with a 503". The PUT refuses it with `400` (per-feature `z.enum`). The ADR's Decision cites only the catalog migration `0008` as the table definition, though chatbot `0001` and sales `0006` exist. The ADR is wrong on both points. | `docs/adr/0009-ai-feature-settings-in-database.md`, "Consequences" and "Decision" |
| G13 | The shopping assistant needs a signed-in customer (Decision 20; BR-CHAT-001). | chatbot-service answers `401 unauthenticated` without a customer identity, but the user guide's Sign in section says "Browsing, searching and the shopping assistant work without an account." The user guide is wrong. | `docs/user-guide.md`, "Sign in", Customer Web paragraph |
