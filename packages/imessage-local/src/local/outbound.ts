import { setTimeout as sleep } from "node:timers/promises";
import type {
  IMessageSDK,
  Message as LocalIMessage,
} from "@photon-ai/imessage-kit";
import type { Content } from "@spectrum-ts/core";
import type { ProviderMessageRecord } from "@spectrum-ts/core/authoring";

const CORRELATION_ATTEMPTS = 12;
const CORRELATION_DELAY_MS = 250;
const CORRELATION_FETCH_LIMIT = 25;

type MessageMatcher = (message: LocalIMessage) => boolean;

const clientTails = new WeakMap<IMessageSDK, Map<string, Promise<void>>>();

const withSpaceLock = async <T>(
  client: IMessageSDK,
  spaceId: string,
  work: () => Promise<T>
): Promise<T> => {
  const tails = clientTails.get(client) ?? new Map<string, Promise<void>>();
  clientTails.set(client, tails);
  const previous = tails.get(spaceId) ?? Promise.resolve();
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.catch(() => {}).then(() => gate);
  tails.set(spaceId, tail);

  await previous.catch(() => {});
  try {
    return await work();
  } finally {
    release();
    if (tails.get(spaceId) === tail) {
      tails.delete(spaceId);
    }
  }
};

const syntheticRecord = (
  spaceId: string,
  content: Content
): ProviderMessageRecord => ({
  id: crypto.randomUUID(),
  content,
  direction: "outbound",
  idSource: "synthetic",
  space: { id: spaceId },
  timestamp: new Date(),
});

const databaseRecord = (
  spaceId: string,
  content: Content,
  message: LocalIMessage
): ProviderMessageRecord => ({
  id: message.id,
  content,
  deliveredAt: message.deliveredAt ?? undefined,
  direction: "outbound",
  idSource: "chat_db",
  isDelivered: message.isDelivered,
  isRead: message.isRead,
  isSent: message.isSent,
  readAt: message.readAt ?? undefined,
  space: { id: spaceId },
  timestamp: message.createdAt,
});

const initialWatermark = async (
  client: IMessageSDK,
  spaceId: string
): Promise<number | undefined> => {
  try {
    const [latest] = await client.getMessages({
      chatId: spaceId,
      isFromMe: true,
      limit: 1,
    });
    return latest?.rowId ?? 0;
  } catch {
    return;
  }
};

const findSentMessage = async (
  client: IMessageSDK,
  spaceId: string,
  watermark: number,
  startedAt: Date,
  matches: MessageMatcher
): Promise<LocalIMessage | undefined> => {
  for (let attempt = 0; attempt < CORRELATION_ATTEMPTS; attempt += 1) {
    try {
      const rows = await client.getMessages({
        chatId: spaceId,
        isFromMe: true,
        limit: CORRELATION_FETCH_LIMIT,
        since: startedAt,
      });
      const match = rows
        .filter((row) => row.rowId > watermark && matches(row))
        .sort((a, b) => a.rowId - b.rowId)[0];
      if (match) {
        return match;
      }
    } catch {
      return;
    }

    if (attempt < CORRELATION_ATTEMPTS - 1) {
      await sleep(CORRELATION_DELAY_MS);
    }
  }
};

/**
 * Serialize sends per chat and correlate Messages.app acceptance with the
 * first matching chat.db row created after the pre-send watermark.
 */
export const sendWithCorrelation = async (
  client: IMessageSDK,
  spaceId: string,
  content: Content,
  matches: MessageMatcher,
  dispatch: () => Promise<void>
): Promise<ProviderMessageRecord> =>
  withSpaceLock(client, spaceId, async () => {
    const startedAt = new Date(Date.now() - 1000);
    const watermark = await initialWatermark(client, spaceId);
    await dispatch();
    if (watermark === undefined) {
      return syntheticRecord(spaceId, content);
    }

    const message = await findSentMessage(
      client,
      spaceId,
      watermark,
      startedAt,
      matches
    );
    return message
      ? databaseRecord(spaceId, content, message)
      : syntheticRecord(spaceId, content);
  });
