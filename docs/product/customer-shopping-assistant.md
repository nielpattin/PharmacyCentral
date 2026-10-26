# Shopping assistant

- **Status:** Current
- **App and route:** customer-web, the floating **Trợ lý tư vấn** widget on every route under the root layout (`RootLayout.tsx`). It has no route of its own.
- **Owner:** @nielpattin
- **Last reviewed:** 2026-10-26

Tags: `[owner]` a recorded owner decision; `[observed]` a code or doc fact read on 2026-10-26; `[standard]` a decision from industry practice. See [README](README.md).

## Purpose

- `[observed]` A signed-in shopper asks questions about products in the catalog, or about how to send a prescription. Product answers come from catalog lookups and appear as product cards (`docs/user-guide.md`, "Shopping assistant").
- `[observed]` The assistant is a shopping aid, not a clinician. It does not diagnose, prescribe or advise on dose, and it cannot see stock, fees or the shopper's own orders and prescriptions. Those questions go to a pharmacist or to the page that shows the answer.
- `[observed]` The widget sits outside the routed page, so the conversation survives navigation, including opening a product from a card (`RootLayout.tsx`).

## Users and entry points

- `[observed]` Signed-in customers only. A signed-out visitor sees no launcher and makes no `/api/chatbot/*` request. The service answers `401 unauthenticated` to any other caller (BR-CHAT-001). See Decision 1.
- `[observed]` Entry point: a round launcher fixed at the bottom right, labelled `aria-label` and `title` "Trợ lý tư vấn", with `/chatbot-icon.svg`. Staff never see the widget; it is mounted only in customer-web.

## User stories and acceptance criteria

### US1. As a signed-in customer, I ask a product question and read the answer with product cards, so that I can find a product without searching

- Source: `[observed]` (code, user guide "Shopping assistant").
- Accepted when:
  - The **Câu hỏi** field (placeholder "Nhập câu hỏi...", at most 1000 characters) and **Gửi** send the question. A question that is blank after trimming does not send. **Gửi** is disabled while a question is pending.
  - The question appears on the right at once. "Đang trả lời…" shows while the request is pending. The reply appears on the left.
  - A reply shows up to 5 cards (rules in US8 and US10). Each card links to `/san-pham/<id>`, shows the image or a monogram, the name, the manufacturer ("Đang cập nhật nhà sản xuất" when empty), and the price as `amount / unitName`, or "Liên hệ báo giá" when there is no price.
  - A reply with no products shows text only.
  - Smoke run: `widget-ask` and `widget-products` in `.agents/skills/verify-pharmacy-central/features/shopping-assistant.md`.
- Rules: BR-CHAT-003, BR-CHAT-006, BR-CHAT-009.

### US2. As a customer, I open and close the assistant and start a new conversation

- Source: `[observed]`.
- Accepted when:
  - The launcher opens and closes the panel titled **Trợ lý tư vấn**; `aria-expanded` on the launcher matches the state. **Đóng** closes the panel.
  - Opening the panel sends no request. The server session is created with the first question (`POST /api/chatbot/sessions`).
  - An empty panel shows "Hỏi về sản phẩm hoặc cách gửi đơn thuốc."
  - **Cuộc trò chuyện mới** clears the transcript and the draft, and the next question starts a new session. A reply still pending when it is pressed is discarded (gap G9).
  - Opening the panel moves focus to **Câu hỏi**. Escape closes the panel and returns focus to the launcher (gap G15).
- Rules: BR-CHAT-002.

### US3. As a customer, when I open a product from a card, the conversation is still there when I come back

- Source: `[observed]`. The intent is recorded in the `RootLayout.tsx` comment.
- Accepted when:
  - A card click is an in-app navigation, so the panel, the transcript and the session survive. Going back shows the same conversation.
  - A full page reload clears the transcript and the session id, which live only in component memory. This is intended: the API has no route to list or reload sessions, and a conversation archive is out of scope.

### US4. As a customer reading a long conversation, the view follows new messages only when I am at the bottom

- Source: `[observed]` (24 px slack in `useStickToBottom.ts`).
- Accepted when:
  - Within 24 px of the end, a new reply scrolls the transcript to the end.
  - After I scroll up, a new reply does not move my position.
  - Sending my own question always scrolls to the end. Smoke run: `widget-follow`.
  - Wheel input over the open panel never scrolls the page behind it, including at the ends of the transcript and over the header and input.

### US5. As a shopper who signs out, I never see the previous customer's conversation

- Source: `[standard]` (signed-out data is never shown to the next visitor; BR-CHAT-001).
- Accepted when:
  - With no customer session, no launcher is rendered and no `/api/chatbot/*` request is made.
  - Sign-out clears the transcript, the draft and the session id. The next customer on the same tab starts with an empty panel.

### US6. As a customer, I see a clear message when the assistant or my question cannot be answered

- Source: `[observed]` for the texts; `[standard]` for the 401 and 24-hour rows.
- Accepted when a failed question stays in the transcript and the panel shows one `role="alert"` line:
  - `503 assistant_unavailable`: "Trợ lý tư vấn đang gặp sự cố. Vui lòng thử lại sau ít phút."
  - `429` with `window: "minute"` (more than 10 questions in a minute): "Bạn hỏi hơi nhanh, vui lòng thử lại sau ít phút."
  - `429` with `window: "day"` (100 questions in 24 hours): "Bạn đã đạt giới hạn câu hỏi trong 24 giờ. Vui lòng thử lại sau." (gap G6)
  - `409 session_full` (20 questions in the session): "Cuộc trò chuyện đã đủ dài. Hãy bắt đầu cuộc trò chuyện mới."
  - `401 unauthenticated`: "Phiên đăng nhập đã hết. Vui lòng đăng nhập lại.", then the shopper is taken to sign-in and back to the page, as for every page (gap G10).
  - Any other failure, including `404 chat_session_not_found`: "Không gửi được câu hỏi. Vui lòng thử lại."
  - After `404` or `409` the next question starts a new session, with the divider of US9 (gap G8).
- Rules: BR-CHAT-004, BR-CHAT-008.

### US7. As a customer, I get a fixed reply for greetings, off-topic questions, emergencies and injection attempts

- Source: `[observed]`.
- Accepted when, with question screening configured:
  - The service answers `200 { reply, products: [] }` with the fixed text from `GATE_REPLIES` (`intent-policy.ts`). The model is not called (`chat-service.test.ts`, `intent-policy.test.ts`).
  - The exchange is saved and counts toward the session and rate limits. An injection attempt is saved as "[Câu hỏi đã bị chặn]".
- Accepted when question screening is not configured: the question is refused with `503 assistant_unavailable` and the model is not called.
- Rules: BR-CHAT-005.

### US8. As a customer, I see a prescription-only product in the cards as prescription-only, with no price and no cart action

- Source: `[standard]` (ADR 0016), BR-ORD-011.
- Accepted when, for a product with `prescriptionRequired = true`:
  - The card shows the **Thuốc kê đơn** badge.
  - The price line reads "Liên hệ báo giá" and no amount is shown (gap G2).
  - A **Gửi đơn thuốc** link to `/gui-don-thuoc` sits beside the card, not nested inside its product link (gap G3).
  - The card has no add-to-cart control.
- Rules: BR-ORD-011, [ADR 0016](../adr/0016-prescription-only-products-are-not-sold-online.md).

### US9. As a customer whose conversation has ended, I can tell that the assistant no longer remembers it

- Source: `[standard]`.
- Accepted when:
  - After a `404` or `409`, the next question starts a new server session, and a divider reads "Trợ lý không còn nhớ các câu trước. Cuộc trò chuyện mới bắt đầu tại đây." appears above it (gap G8).
  - The earlier messages stay visible above the divider as history. They are not sent to the server again.
  - A session with no question for 24 hours is no longer accepted: its next question gets `404 chat_session_not_found`, and the same divider appears (gap G13).

### US10. As a customer, the cards match the answer

- Source: `[standard]`.
- Accepted when:
  - A card appears for each product the reply recommends, at most 5, each product once, and only for those (gap G4).

### US11. As a keyboard or screen-reader user, I can operate the panel and hear new replies

- Source: `[standard]` (WCAG 2.2 AA).
- Accepted when:
  - New replies and "Đang trả lời…" are announced through a polite live region. The `role="alert"` line is announced as an alert (gap G15).
  - Tab reaches, in reading order: **Cuộc trò chuyện mới**, **Đóng**, the transcript links, **Câu hỏi**, **Gửi**. Escape closes the panel and returns focus to the launcher (gap G15).

## Contents and behavior

`[observed]` unless marked.

- **Launcher:** round button, fixed at the bottom right, above the page. The page has bottom padding so the last content clears it (`RootLayout.tsx`).
- **Panel:** about 440 px wide and 620 px tall, shrinking on small screens. Header: **Trợ lý tư vấn**, **Cuộc trò chuyện mới**, **Đóng**. Transcript: the shopper's bubbles on the right, the assistant's on the left. Assistant bubbles with products are full width and list the cards under the text. Line breaks are kept. Status line: "Đang trả lời…" or the alert. Composer: **Câu hỏi** and **Gửi**; Enter submits.
- **Session:** one server session per panel, created with the first question. The id is held in memory only.
- **Assistant (server):**
  - Two tools: `search_products` (by need, symptom, name or active ingredient) and `get_product_details` (by SKU). Details are only available for a SKU that appeared earlier in the conversation: on a card of an earlier reply, or in a search result of this question (BR-CHAT-006, `chat-service.ts`).
  - Limits per question: 2 tool rounds and 4 tool calls. Every product a tool returned in that question is a candidate for the cards (gap G4).
  - Prompt rules (`SYSTEM_RULES`): answer in Vietnamese, briefly, in plain text. Talk only about products in tool results or named earlier in this conversation (Decision 5). Quote the listed price for one sale unit and say the final price is confirmed at checkout. Say when a product has no list price. Say nothing about stock. Do not diagnose or prescribe; send dosage and interaction questions to a pharmacist. Say when a product needs a prescription. Call no tool for greetings, thanks, prescription-photo or QR questions, or ordering steps. These are prompt text, not code checks (BR-CHAT-007).
  - The assistant cannot place or change an order, cannot see stock, and cannot read the shopper's orders or prescriptions. Its only tools are the two catalog lookups.
- **Limits:** question length 1 to 1000 characters after trimming; 20 questions per session; 10 per minute and 100 per rolling 24 hours per customer, across sessions (BR-CHAT-003, BR-CHAT-004).
- **Retention:** a transcript is deleted 90 days after the last question of its session (gap G13). Chat transcripts are not audit records (Decision 12).

## States

- **Signed out:** no launcher, no request.
- **Closed:** launcher only.
- **Open, empty:** the hint. No request yet.
- **Pending:** "Đang trả lời…". **Gửi** disabled.
- **Answered:** text, plus cards when products are recommended.
- **Failed:** the alert lines of US6. The question stays in the transcript. The server saves nothing for `400`, `404`, `409`, `429` or `503`, so a retry is not counted twice.
- **Session ended:** the divider of US9.
- **Chat model not configured:** the shopper sees the same `503` text as an outage, and the session is still created. The Platform Admin card reads "Không có khóa, trợ lý không thể trả lời." (Decision 9).
- **Question screening not configured, catalog or model failing:** `503 assistant_unavailable` (Decision 10, BR-CHAT-008).

## Out of scope

- Adding to the cart, placing or changing an order, or any action on the shopper's account from the chat.
- Stock status, fees, delivery times and refund terms. The assistant points to the page that shows them (Decision 11 and 13).
- Diagnosis, dose advice, prescribing, and emergency handling beyond the fixed reply.
- A transcript that survives a page reload, a list of past conversations, and signed-out (guest) use.
- A handoff to a pharmacist inside the chat. The pharmacist consultation is on [prescription intake](customer-prescription-intake-page.md).
- Staff use: staff-web has no assistant panel.

## Rules and designs

Business rules, section 21 of [business-rules.md](../business-rules.md): BR-CHAT-001 to BR-CHAT-009. BR-CHAT-005 needs the no-classifier refusal (Decision 10), and BR-CHAT-007 needs the wording in gap G5.
- BR-ORD-011 and [ADR 0016](../adr/0016-prescription-only-products-are-not-sold-online.md): prescription-only products are not put in the cart or sold online. [ADR 0004](../adr/0004-server-authoritative-pricing-stock-and-fees.md): a chat price is a listed preview; the server prices the order.
- BR-CRED-001 to BR-CRED-003 and [ADR 0009](../adr/0009-ai-feature-settings-in-database.md): stored AI settings, and no settings means 503.
- [Staff AI integrations](staff-ai-integrations.md): the Platform Admin cards for the assistant and question screening. [Customer product page](customer-product-page.md) and [prescription intake](customer-prescription-intake-page.md): where a shopper continues from a card.
- [User guide, Shopping assistant](../user-guide.md#shopping-assistant) and [API guide, Shopping assistant](../api-guide.md#shopping-assistant).

## Decisions

| # | Question | Decision | Why |
| --- | --- | --- | --- |
| 1 | Who may use the assistant? | Signed-in customers only. A signed-out visitor sees no launcher. `[standard]` | Each conversation and each limit belongs to one customer (BR-CHAT-002, BR-CHAT-004), and the questions can describe a person's health. Owner may change (who may use it). |
| 2 | Prescription-only products in cards? | No amount. The card shows "Liên hệ báo giá", the **Thuốc kê đơn** badge and a **Gửi đơn thuốc** link (US8). `[standard]` | The product is not sold online (ADR 0016), so no price is offered for ordering. The user guide must say the same (gap G2). |
| 3 | Badge wording? | Keep "Thuốc kê đơn" on cards. "Cần đơn thuốc" is only the text of a disabled button. `[standard]` | One label for the product status and one for the disabled control, the same across the app. |
| 4 | Cards versus the answer? | A card appears only for a product the reply recommends, at most 5. The model names the SKUs it recommends in a structured field, and the server keeps only SKUs that a tool returned (US10). `[standard]` | A card the answer never mentions is unexplained. A recommended product without a card leaves the shopper no way to open it. Tool results stay the only source (BR-CHAT-006). |
| 5 | Products named earlier in the conversation? | Allowed, with a limit. A product named in an earlier reply may be discussed by name. Any price or detail comes from a tool result in the current question. BR-CHAT-007 is aligned to this (gap G5). `[standard]` | The prompt already allows it. The stored history keeps only SKU and name, so an old price cannot be quoted anyway, and a fresh tool result keeps the price current. |
| 6 | Daily limit message? | A separate message for the 24-hour cap (US6). The 429 body carries `window`: `minute` or `day` (gap G6). `[standard]` | A 24-hour cap cannot clear in minutes, so "wait a moment" is false for it. The window is a rolling 24 hours, so the message gives no clock time. |
| 7 | Sign-out? | Sign-out and account change clear the transcript, the draft and the session id (US5). `[standard]` | Nothing the signed-in shopper read should stay for the next visitor. Today the next customer sees the old transcript and then gets a 404. |
| 8 | Lost context after 404 or 409? | Keep the old messages visible as history, show the divider of US9, and start a new session on the next question. `[standard]` | The server cannot take old turns back: accepting history from the client would let the client rewrite what the model reads. The divider tells the shopper the assistant no longer remembers. |
| 9 | Chat model not configured? | One message: the same `503` text as an outage. The launcher stays visible. Ops sees the state on the AI integrations card and in the service error log. Owner may change (whether to hide the launcher). `[standard]` | The shopper cannot fix a server setting, and a different message would reveal back-office state. Platform Admin already gets the card text. |
| 10 | Question screening off? | Fail closed. With no classifier configured, the question is refused with `503 assistant_unavailable` and no model call (US7). Owner may change: the assistant stays down until the screening credential is saved. `[standard]` | A missing classifier should behave like a classifier that is down. Today a configured classifier that fails after three attempts already answers 503 (BR-CHAT-005, BR-CHAT-008). The screening guards emergencies and injection; the prompt text does not replace it. |
| 11 | Ordering steps? | Intended: no catalog lookup. The assistant names the page where the step happens (cart, **Gửi đơn thuốc**, **Đơn của tôi**). It states no fees, delivery times, stock or refund terms, and points to the checkout page or a pharmacist (gap G12). `[standard]` | The steps are on the pages. The catalog has no order policy, so a free-text answer would invent one. |
| 12 | Session expiry and retention? | A session with no question for 24 hours is closed (US9). Transcripts are deleted 90 days after the session's last question. Chat transcripts are not audit records. Owner may change (the 90 days). `[standard]` | Limits are per customer over a rolling 24 hours, so a day-old session is no longer a live conversation. Health-related text should not be kept longer than a follow-up needs. |
| 13 | Stock questions? | The assistant says it cannot see stock at a pharmacy and points to the product page, which shows stock for the pharmacy the shopper picked (storefront rule). It never says the product is in stock. `[standard]` | The chat has no pharmacy choice and no stock data. A stock statement from the chat could be wrong for the pharmacy the shopper uses. |

## Gaps against the code (2026-10-26)

| ID | The spec requires | The code does today | Where |
| --- | --- | --- | --- |
| G1 | Signed-in customers only (Decision 1, BR-CHAT-001). | Code agrees. The user guide's "Sign in", "Customer Web" section says browsing and "the shopping assistant work without an account". The user guide is wrong. | `docs/user-guide.md`, "Sign in", "Customer Web" section. |
| G2 | Prescription-only card: no amount, "Liên hệ báo giá" (US8). | `CatalogProductLookup` prices every product with an active sale unit, and the card shows the amount for any product. The user guide's "Prescription intake" section says prescription-only products "cannot be added to the cart without a price". That is wrong under BR-ORD-011: they cannot be added at all. | `apps/chatbot-service/src/infrastructure/catalog-product-lookup.ts` (`withPrice`); `apps/customer-web/src/components/storefront/ChatbotWidget.tsx`; `docs/user-guide.md`, "Prescription intake". |
| G3 | Prescription-only card has a **Gửi đơn thuốc** link beside it (US8). | Not rendered. The card shows only the badge. | `ChatbotWidget.tsx`, card block. |
| G4 | Cards only for recommended products, at most 5 (US10, Decision 4). | Every product any tool returned becomes a card, up to 5, in discovery order (`surfaced` in `sendChatMessage`). `docs/api-guide.md`, "Shopping assistant", describes the list as "the order the assistant first found them". The code is wrong; the API guide must follow the change. | `apps/chatbot-service/src/modules/chat/chat-service.ts`; `docs/api-guide.md`, "Shopping assistant". |
| G5 | Products named earlier may be discussed; facts come from a tool result in the question (Decision 5). | `SYSTEM_RULES` allows products "đã giới thiệu trước đó". BR-CHAT-007 allows only products "có trong kết quả công cụ". The prompt matches the decision; BR-CHAT-007 must be aligned. | `docs/business-rules.md`, BR-CHAT-007; `chat-service.ts`, `SYSTEM_RULES`. |
| G6 | Separate 429 text for the 24-hour cap; body carries `window` (Decision 6). | One `rate_limited` problem for both windows. The widget shows the minute text for both. The API guide and BR-CHAT-004 do not mention `window`. | `apps/chatbot-service/src/modules/chat/chat-routes.ts`; `chat-session-store.ts` (`ChatRateLimitedError`); `ChatbotWidget.tsx` (`failureText`); `docs/api-guide.md`, "Shopping assistant"; `docs/business-rules.md`, BR-CHAT-004. |
| G8 | Divider after 404 or 409 (US9, Decision 8). | No divider. The old transcript reads as one conversation with the new session. | `ChatbotWidget.tsx` (`onError`, `submit`). |
| G9 | A reply pending when **Cuộc trò chuyện mới** is pressed is discarded (US2). | **Cuộc trò chuyện mới** stays enabled while pending. `onSuccess` appends the late reply to the new transcript, and `mutationFn` stores the old session id again after the reset. | `ChatbotWidget.tsx` (`startNewChat`, `mutation`). |
| G10 | A 401 ends the session the app-wide way, with a notice and a return to the page (US6). | A 401 ends the session app-wide (`RootLayout.tsx`, `SessionEndedDialog`): the notice "Phiên đã hết hạn. Vui lòng đăng nhập lại." opens over the page, and the widget disappears with the session. The notice wording differs from the spec, and sign-in is a dialog, not a route. The widget itself has no session-end handling. | `customer-api.ts` `request`; `components/RootLayout.tsx`; `components/storefront/ChatbotWidget.tsx` (`failureText`) |
| G12 | No answers on stock, fees, delivery times or refunds; ordering steps name the page (Decisions 11, 13). | `SYSTEM_RULES` says not to talk about stock and says nothing about fees, delivery or refunds, and does not name the pages. | `chat-service.ts`, `SYSTEM_RULES`. |
| G13 | Sessions close after 24 hours without a question; transcripts deleted 90 days after the last question (Decision 12, US9). | No expiry check in `findOwnedHistory`. No delete job for `chat_sessions` or `chat_messages`, so rows are kept indefinitely. | `apps/chatbot-service/src/infrastructure/drizzle-chat-session-store.ts`; `apps/chatbot-service/drizzle/migrations/0000_chat_sessions.sql`. |
| G14 | Prices are taken for the Asia/Ho_Chi_Minh calendar day (storefront date rule). | `utcDate` takes the UTC calendar day. From 00:00 to 07:00 in Vietnam, the chat quotes the previous day's price. | `apps/chatbot-service/src/infrastructure/catalog-product-lookup.ts` (`utcDate`). |
| G15 | Live region for replies and status; Escape closes and returns focus; opening focuses **Câu hỏi** (US2, US11). | None of these exist: no live region, no Escape handler, no focus move. The smoke note `widget-open` expects focus on the field, which the code does not set. | `ChatbotWidget.tsx`; `.agents/skills/verify-pharmacy-central/features/shopping-assistant.md`. |
