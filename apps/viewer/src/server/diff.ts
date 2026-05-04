import type { CanonicalExchange, Message } from "@llmviz/canonical"

export interface ExchangeDiff {
  readonly unchangedMessages: number
  readonly newMessages: ReadonlyArray<Message>
  /** The prior exchange's history is not a prefix of this one, so its tail was dropped or rewritten. */
  readonly diverged: boolean
  readonly systemPromptChanged: boolean
}

const identical = (a: Message, b: Message): boolean => JSON.stringify(a) === JSON.stringify(b)

/**
 * Within a session an exchange normally extends the previous one's message history (that is the
 * prefix-grouping criterion), so the shared head can be collapsed and only the tail shown.
 */
export const diffExchange = (prior: CanonicalExchange, next: CanonicalExchange): ExchangeDiff => {
  let shared = 0
  while (
    shared < prior.messages.length &&
    shared < next.messages.length &&
    identical(prior.messages[shared]!, next.messages[shared]!)
  ) {
    shared += 1
  }

  return {
    unchangedMessages: shared,
    newMessages: next.messages.slice(shared),
    diverged: shared < prior.messages.length,
    systemPromptChanged: prior.systemPrompt !== next.systemPrompt
  }
}
