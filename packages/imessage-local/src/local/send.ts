import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { IMessageSDK } from "@photon-ai/imessage-kit";
import { type Content, toVCard } from "@spectrum-ts/core";
import type { ProviderMessageRecord } from "@spectrum-ts/core/authoring";
import { unsupportedLocalContent } from "../../../imessage/src/shared/errors";
import { vcardFileName } from "../../../imessage/src/shared/vcard";
import { DEFAULT_ATTACHMENT_NAME } from "./attachments";
import { sendWithCorrelation } from "./outbound";

const sendTempFile = async (
  client: IMessageSDK,
  spaceId: string,
  name: string,
  data: Buffer
): Promise<void> => {
  const safeName = basename(name) || DEFAULT_ATTACHMENT_NAME;
  const dir = await mkdtemp(join(tmpdir(), "spectrum-"));
  const tmp = join(dir, safeName);
  await writeFile(tmp, data);
  try {
    await client.send({ to: spaceId, attachments: [tmp] });
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
};

export const send = async (
  client: IMessageSDK,
  spaceId: string,
  content: Content
): Promise<ProviderMessageRecord> => {
  switch (content.type) {
    case "text":
      return sendWithCorrelation(
        client,
        spaceId,
        content,
        (message) => message.text === content.text,
        () => client.send({ to: spaceId, text: content.text })
      );
    case "attachment": {
      const safeName = basename(content.name) || DEFAULT_ATTACHMENT_NAME;
      return sendWithCorrelation(
        client,
        spaceId,
        content,
        (message) =>
          message.attachments.some(
            (attachment) => attachment.fileName === safeName
          ),
        async () =>
          sendTempFile(client, spaceId, safeName, await content.read())
      );
    }
    case "contact": {
      const vcf = await toVCard(content);
      const name = vcardFileName(content);
      return sendWithCorrelation(
        client,
        spaceId,
        content,
        (message) =>
          message.attachments.some(
            (attachment) => attachment.fileName === name
          ),
        () => sendTempFile(client, spaceId, name, Buffer.from(vcf, "utf8"))
      );
    }
    case "effect":
      throw unsupportedLocalContent(
        "effect",
        "message effects require remote iMessage"
      );
    case "poll":
      throw unsupportedLocalContent("poll");
    default:
      throw unsupportedLocalContent(content.type);
  }
};
