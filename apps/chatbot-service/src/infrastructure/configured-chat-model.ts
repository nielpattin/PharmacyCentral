import type { ChatCompletion, ChatCompletionInput, ChatModel } from "../domain/chat-model.ts";
import { ChatModelError } from "../domain/chat-model.ts";

export class ConfiguredChatModel implements ChatModel {
  public constructor(private readonly source: () => Promise<ChatModel | undefined>) {}

  public async complete(input: ChatCompletionInput): Promise<ChatCompletion> {
    let model: ChatModel | undefined;
    try {
      model = await this.source();
    } catch (cause) {
      throw new ChatModelError("The AI provider settings could not be read", { cause });
    }
    if (!model) {
      throw new ChatModelError("No AI provider is configured");
    }
    return model.complete(input);
  }
}
