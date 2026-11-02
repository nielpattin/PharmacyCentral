import { Badge, Button, Input } from "@pharmacy/ui";
import { useMutation } from "@tanstack/react-query";
import { useRef, useState } from "react";

import { useSession } from "../../auth.ts";
import { ApiError, sendChatbotMessage, startChatbotSession, type ChatbotProduct } from "../../customer-api.ts";
import { useStickToBottom } from "../../hooks/useStickToBottom.ts";
import { formatMoney } from "../../storefront/format.ts";
import { Link } from "./Link.tsx";
import { ProductTile } from "./ProductTile.tsx";

type ChatEntry = { role: "user"; content: string } | { role: "assistant"; content: string; products: ChatbotProduct[] };

const MAX_QUESTION_LENGTH = 1000;
const SESSION_GONE_STATUSES: Record<number, true> = { 404: true, 409: true };

const isSessionGone = (error: unknown): boolean =>
  error instanceof ApiError && SESSION_GONE_STATUSES[error.status] === true;

const failureText = (error: unknown): string => {
  if (error instanceof ApiError && error.code === "ai_budget_exceeded")
    return "Trợ lý tư vấn đã đạt giới hạn chi phí, tạm thời chưa trả lời được. Vui lòng quay lại sau.";
  if (error instanceof ApiError && error.code === "assistant_busy")
    return "Trợ lý tư vấn đang bận. Vui lòng gửi lại sau vài giây.";
  if (error instanceof ApiError && error.status === 503)
    return "Trợ lý tư vấn đang gặp sự cố. Vui lòng thử lại sau ít phút.";
  if (error instanceof ApiError && error.status === 429) return "Bạn hỏi hơi nhanh, vui lòng thử lại sau ít phút.";
  if (error instanceof ApiError && error.status === 409)
    return "Cuộc trò chuyện đã đủ dài. Hãy bắt đầu cuộc trò chuyện mới.";
  return "Không gửi được câu hỏi. Vui lòng thử lại.";
};

// Wheel input over the panel must never scroll the page behind it: let a scrollable list under the pointer take it
// while it has room, and swallow it otherwise.
const trapWheel = (panel: HTMLElement | null): (() => void) | undefined => {
  if (!panel) return undefined;
  const hasRoom = (element: HTMLElement, deltaY: number): boolean =>
    element.scrollHeight > element.clientHeight &&
    /auto|scroll/.test(getComputedStyle(element).overflowY) &&
    (deltaY < 0 ? element.scrollTop > 0 : element.scrollTop + element.clientHeight < element.scrollHeight - 1);
  const onWheel = (event: WheelEvent): void => {
    for (let node = event.target as HTMLElement | null; node; node = node.parentElement) {
      if (hasRoom(node, event.deltaY)) return;
      if (node === panel) break;
    }
    event.preventDefault();
  };
  panel.addEventListener("wheel", onWheel, { passive: false });
  return () => panel.removeEventListener("wheel", onWheel);
};

export const ChatbotWidget = (): React.JSX.Element | null => {
  const session = useSession();
  const { container, content, follow } = useStickToBottom();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const sessionIdRef = useRef<string | undefined>(undefined);
  const mutation = useMutation({
    mutationFn: async (content: string) => {
      const sessionId = sessionIdRef.current ?? (await startChatbotSession()).id;
      sessionIdRef.current = sessionId;
      return sendChatbotMessage(sessionId, content);
    },
    onSuccess: (reply) => {
      setEntries((current) => [...current, { role: "assistant", content: reply.reply, products: reply.products }]);
    },
    onError: (error) => {
      if (isSessionGone(error)) sessionIdRef.current = undefined;
    },
  });

  // Until the session probe answers, neither the chat nor the sign-in prompt is known to be the right one to show.
  if (!session.resolved) return null;

  const submit = (event: React.SyntheticEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const question = draft.trim();
    if (!question || mutation.isPending) return;
    setEntries((current) => [...current, { role: "user", content: question }]);
    setDraft("");
    follow();
    mutation.mutate(question);
  };

  const startNewChat = (): void => {
    sessionIdRef.current = undefined;
    setEntries([]);
    setDraft("");
  };

  return (
    <div className="fixed right-[calc(1rem+env(safe-area-inset-right))] bottom-[calc(1rem+env(safe-area-inset-bottom))] z-40 flex flex-col items-end gap-3">
      {open ? (
        <section
          ref={trapWheel}
          aria-label="Trợ lý tư vấn"
          className="flex h-[620px] max-h-[calc(100vh-6rem)] w-[440px] max-w-[calc(100vw-2rem)] flex-col rounded-lg border border-line bg-surface shadow-lg"
        >
          <header className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="text-sm font-semibold text-ink">Trợ lý tư vấn</h2>
            <div className="flex gap-2">
              {session.authenticated ? (
                <Button variant="ghost" size="sm" onClick={startNewChat}>
                  Cuộc trò chuyện mới
                </Button>
              ) : null}
              <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
                Đóng
              </Button>
            </div>
          </header>
          {session.authenticated ? (
            <>
              <div ref={container} className="flex-1 overflow-y-auto overscroll-contain px-4 py-3 text-sm">
                <div ref={content} className="space-y-3">
                  {entries.length === 0 ? <p className="text-muted">Hỏi về sản phẩm hoặc cách gửi đơn thuốc.</p> : null}
                  {entries.map((entry, index) => (
                    <div
                      key={`${entry.role}-${index}`}
                      className={
                        entry.role === "user"
                          ? "ml-auto max-w-[85%] rounded-lg bg-primary px-3 py-2 text-white"
                          : entry.products.length
                            ? "w-full rounded-lg bg-surface-soft px-3 py-2 text-ink"
                            : "max-w-[90%] rounded-lg bg-surface-soft px-3 py-2 text-ink"
                      }
                    >
                      <p className="whitespace-pre-line">{entry.content}</p>
                      {entry.role === "assistant" && entry.products.length ? (
                        <ul className="mt-2 space-y-2">
                          {entry.products.map((product) => (
                            <li key={product.id}>
                              <Link
                                className="flex items-start gap-3 rounded-lg border border-line bg-surface p-2 transition-shadow hover:shadow-md"
                                href={`/san-pham/${product.id}`}
                              >
                                <ProductTile
                                  name={product.name}
                                  seed={product.sku}
                                  imageUrl={product.imageUrl}
                                  className="h-16 w-16 shrink-0"
                                  monogramClassName="text-lg"
                                />
                                <div className="min-w-0 flex-1">
                                  <p className="line-clamp-2 font-medium text-ink">{product.name}</p>
                                  <p className="mt-0.5 line-clamp-1 text-xs text-muted">
                                    {product.manufacturer ?? "Đang cập nhật nhà sản xuất"}
                                  </p>
                                  {product.prescriptionRequired ? (
                                    <div className="mt-1">
                                      <Badge variant="danger">Thuốc kê đơn</Badge>
                                    </div>
                                  ) : null}
                                  <p className="mt-1 text-xs">
                                    {product.price ? (
                                      <>
                                        <span className="font-semibold text-danger">
                                          {formatMoney(product.price.amount, product.price.currency)}
                                        </span>
                                        <span className="text-muted"> / {product.price.unitName}</span>
                                      </>
                                    ) : (
                                      <span className="text-muted">Liên hệ báo giá</span>
                                    )}
                                  </p>
                                </div>
                              </Link>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  ))}
                  {mutation.isPending ? <p className="text-muted">Đang trả lời…</p> : null}
                  {mutation.isError ? (
                    <p role="alert" className="text-danger">
                      {failureText(mutation.error)}
                    </p>
                  ) : null}
                </div>
              </div>
              <form onSubmit={submit} className="flex gap-2 border-t border-line p-3">
                <Input
                  aria-label="Câu hỏi"
                  value={draft}
                  maxLength={MAX_QUESTION_LENGTH}
                  placeholder="Nhập câu hỏi..."
                  onChange={(event) => setDraft(event.target.value)}
                />
                <Button type="submit" disabled={mutation.isPending || draft.trim() === ""}>
                  Gửi
                </Button>
              </form>
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center text-sm">
              <p className="text-base font-semibold text-ink">Đăng nhập để trò chuyện với trợ lý tư vấn</p>
              <p className="text-muted">
                Trợ lý trả lời về sản phẩm và cách gửi đơn thuốc, và gắn cuộc trò chuyện với tài khoản khách hàng của
                bạn.
              </p>
              <Link
                href="/tai-khoan"
                className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-white outline-none hover:bg-primary-dark focus-visible:ring-2 focus-visible:ring-primary/50"
              >
                Đăng nhập
              </Link>
            </div>
          )}
        </section>
      ) : null}
      <Button
        variant="ghost"
        className="h-14 w-14 rounded-full p-0 shadow-lg"
        aria-label="Trợ lý tư vấn"
        title="Trợ lý tư vấn"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <img src="/chatbot-icon.svg" alt="" className="h-14 w-14 rounded-full" />
      </Button>
    </div>
  );
};
