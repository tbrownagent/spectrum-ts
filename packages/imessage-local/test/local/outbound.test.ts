import {
  IMessageSDK,
  type Message as LocalIMessage,
} from "@photon-ai/imessage-kit";
import { describe, expect, it, vi } from "vitest";
import { send } from "@/local/send";

const SPACE_ID = "any;-;+15551234567";

const localMessage = (overrides: Partial<LocalIMessage> = {}): LocalIMessage =>
  ({
    attachments: [],
    chatId: SPACE_ID,
    chatKind: "dm",
    createdAt: new Date("2026-09-07T12:00:00Z"),
    deliveredAt: null,
    id: "chat-db-guid",
    isDelivered: false,
    isFromMe: true,
    isRead: false,
    isSent: true,
    kind: "text",
    readAt: null,
    rowId: 101,
    text: "hello",
    ...overrides,
  }) as unknown as LocalIMessage;

const localClient = (members: {
  getMessages?: IMessageSDK["getMessages"];
  send?: IMessageSDK["send"];
}): IMessageSDK =>
  Object.assign(Object.create(IMessageSDK.prototype), members) as IMessageSDK;

describe("local outbound correlation", () => {
  it("returns the real chat.db guid and delivery snapshot", async () => {
    const sent = localMessage({
      deliveredAt: new Date("2026-09-07T12:00:01Z"),
      isDelivered: true,
    });
    const getMessages = vi
      .fn<IMessageSDK["getMessages"]>()
      .mockResolvedValueOnce([localMessage({ id: "older", rowId: 100 })])
      .mockResolvedValueOnce([sent]);
    const dispatch = vi.fn<IMessageSDK["send"]>().mockResolvedValue();
    const client = localClient({ getMessages, send: dispatch });

    const record = await send(client, SPACE_ID, {
      text: "hello",
      type: "text",
    });

    expect(record).toMatchObject({
      deliveredAt: sent.deliveredAt,
      direction: "outbound",
      id: "chat-db-guid",
      idSource: "chat_db",
      isDelivered: true,
      isRead: false,
      isSent: true,
      timestamp: sent.createdAt,
    });
    expect(dispatch).toHaveBeenCalledWith({ to: SPACE_ID, text: "hello" });
  });

  it("falls back immediately when chat.db queries are unavailable", async () => {
    const dispatch = vi.fn<IMessageSDK["send"]>().mockResolvedValue();
    const client = localClient({
      getMessages: vi
        .fn<IMessageSDK["getMessages"]>()
        .mockRejectedValue(new Error("Full Disk Access required")),
      send: dispatch,
    });

    const record = await send(client, SPACE_ID, {
      text: "hello",
      type: "text",
    });

    expect(record).toMatchObject({
      direction: "outbound",
      idSource: "synthetic",
    });
    expect(record.id).toEqual(expect.any(String));
    expect(dispatch).toHaveBeenCalledOnce();
  });

  it("does not mistake an older identical message for the new send", async () => {
    const older = localMessage({ id: "older", rowId: 100 });
    const sent = localMessage({ id: "new", rowId: 101 });
    const getMessages = vi
      .fn<IMessageSDK["getMessages"]>()
      .mockResolvedValueOnce([older])
      .mockResolvedValueOnce([older, sent]);
    const client = localClient({
      getMessages,
      send: vi.fn<IMessageSDK["send"]>().mockResolvedValue(),
    });

    const record = await send(client, SPACE_ID, {
      text: "hello",
      type: "text",
    });

    expect(record.id).toBe("new");
  });
});
