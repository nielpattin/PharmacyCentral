# Shopping assistant widget

A signed-in shopper opens the floating assistant, asks a product question, reads the reply with product cards, and starts a new chat. The chat follows new messages only while the shopper stays at the bottom. The session stops after 20 questions. Live answers call the chat model, so the live path is AI-gated and needs the user's explicit approval for that run. A UI-only stub proof is allowed without approval, and it proves no model behavior.

## Sub-features

- `widget-open` opens the panel from the floating button.
- `widget-ask` posts a question and shows the reply.
- `widget-products` shows product cards in a reply and links each to `/san-pham/<id>`.
- `widget-follow` keeps the newest message in view only while the shopper is at the bottom.
- `widget-limits` shows the error text for `409 session_full`, `429`, and `503`.
- `widget-new-chat` clears the entries and starts a new session on the next question.

## How to get to it (user POV)

- Sign in as a customer. The button `Trợ lý tư vấn` appears at the bottom right of every storefront page. It does not render for signed-out visitors.
- Choose the button to open the panel titled `Trợ lý tư vấn`. Type in the field `Câu hỏi` and choose `Gửi`.
- Choose `Cuộc trò chuyện mới` in the panel to start over, or `Đóng` to close it.

## Driving it with the browser global

Preconditions:

- A signed-in customer. Use the saved state `~/.omp/browser-profiles/customer.json` as in customer-sign-in-account.md. Confirm `GET /api/auth/me` returns `khachhang@pharmacycentral.vn` before the first step.
- Mode chosen with the user.
  - Dev mode, UI-only stub: `node .agents/skills/verify-pharmacy-central/scripts/launch.mjs --need identity-service,sales-service,customer-web`. Chatbot is not started.
  - Dev mode, live path: add `chatbot-service` and `catalog-service` and `--ai-approved`. Chatbot calls the chat model for every question the intent gate lets through, and catalog answers its product lookups. The gate is a second AI provider (`typesafe`, `ai-provider-config.ts`) and can end a turn without a model call.
  - Container mode: `pnpm run stack:up` is healthy with the user's approval recorded for the live path. No launch. For the UI-only stub, the stub still replaces `/api/chatbot/*` in the browser, so chatbot's container being up does not matter.
- `node .agents/skills/verify-pharmacy-central/scripts/doctor.mjs --mode <dev|container> --need identity-service,sales-service,customer-web --role customer` reports `RESULT ready`.

UI-only stub recipe (label the evidence `ui-only-stub`, never a live result):

```js
const stub = `(() => {
  const realFetch = window.fetch.bind(window);
  let questions = 0;
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  window.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input.url;
    if (!url.includes("/api/chatbot/")) return realFetch(input, init);
    if (url.endsWith("/api/chatbot/sessions") && init.method === "POST") return json(201, { id: "stub-session" });
    if (url.includes("/messages") && init.method === "POST") {
      questions += 1;
      if (questions > 20) return json(409, { title: "Chat session is full", status: 409, code: "session_full" });
      await new Promise((done) => setTimeout(done, 1500));
      return json(200, { reply: "Stub reply " + questions + " ".repeat(400), products: [] });
    }
    return json(404, { title: "Not Found", status: 404 });
  };
})()`;
const { homedir } = await import("node:os");
const { join } = await import("node:path");
const statePath = join(homedir(), ".omp", "browser-profiles", "customer.json");
const tab = await browser.open({
  name: "customer-ui-stub",
  url: "http://customer.pharmacy.localhost/",
  viewport: { width: 1920, height: 1080 },
  app: { tern: false, relay: false },
  init_scripts: [stub],
  timeout: 90,
});
await tab.loadState(statePath);
await tab.goto("http://customer.pharmacy.localhost/");
```

Then confirm `GET /api/auth/me` returns the customer email, and run `tab.clearCookies()` and `tab.close()` when the drive ends. Run the snippet from the repo root.

Steps:

- **Open the widget.** Run `tab.click('role/button[name="Trợ lý tư vấn"]')`. Result: the panel `section` named `Trợ lý tư vấn` appears, its input `Câu hỏi` has focus, and the hint `Hỏi về sản phẩm hoặc cách gửi đơn thuốc.` shows.
- **Ask.** Run `tab.fill('input[aria-label="Câu hỏi"]', "Paracetamol giá bao nhiêu?")`, then `tab.click('role/button[name="Gửi"]')`. Result: the question appears on the right, `Đang trả lời…` shows while pending, then the reply text appears on the left.
- **Products (live path only).** The stub returns no products. With a live reply that carries products, each card is a link to `/san-pham/<id>`. Result: the card name matches the product, and the link `href` contains `/san-pham/`.
- **Follow.** Send one question. Sending always scrolls to the newest message. Right after sending, while the reply is still pending, set `scrollTop` to `0` on `section[aria-label="Trợ lý tư vấn"] .overflow-y-auto` with `tab.evaluate`. When the reply lands, read `scrollTop` again. Result: it stays near `0`, because the shopper left the bottom and the reply did not pull the view down. Then set `scrollTop` to the `scrollHeight`, send another question, and confirm the newest reply is visible.
- **Limit.** Send 21 questions with the stub. Result: the 21st shows `Cuộc trò chuyện đã đủ dài. Hãy bắt đầu cuộc trò chuyện mới.` in an alert. The live service answers the same way with `409 session_full` after 20 questions, but only when the questions are paced under 10 per minute. Faster, the 11th question answers `429` and the alert reads `Bạn hỏi hơi nhanh…` (`ChatbotWidget.tsx:20`), so the stub is the only quick way to reach the 409 text.
- **New chat.** Choose `Cuộc trò chuyện mới`. Result: the entries clear and the hint shows again. The next question starts a new session.
- **Evidence.** Label the run `ui-only-stub` in `meta.json`. Capture the panel with `tab.ariaSnapshot()` and a screenshot.

Live path, only with approval: the same steps without the stub. Also record the `chat turn usage` log line from chatbot-service (dev mode: the launch log; container mode: `docker compose logs chatbot-service`), which holds the token counts and `modelCalls`. The runbook calls it out in its chatbot section.

## Gotchas

- The widget does not render for signed-out visitors. A missing button means the shopper is signed out. Sign in before you report a failure.
- Chatbot limits: 20 questions per session, 10 per minute, and 100 per day. Those constants live in `apps/chatbot-service/src/modules/chat/chat-service.ts`. A live run that loops can reach the daily cap.
- Each live question costs model calls. The chatbot-service log reports `modelCalls` for every question.
- Opening a product from a chat card navigates away. The widget sits in the root layout, so its entries should survive the route change. Confirm this in the first run before you rely on it.
- The stub proves the widget UI. It proves nothing about the answers, the product tools, or the session service. Never report a stub run as a live chatbot result.
