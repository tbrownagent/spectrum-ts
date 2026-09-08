import type { SchemaMessage } from "@spectrum-ts/core";
import z from "zod";

export const configSchema = z.object({});

export const userSchema = z.object({
  address: z.string().optional(),
  country: z.string().optional(),
  service: z.enum(["iMessage", "SMS", "RCS", "unknown"]).optional(),
});

export const spaceSchema = z.object({
  id: z.string(),
  type: z.enum(["dm", "group"]),
  phone: z.string(),
});

export const spaceParamsSchema = z.object({});

export const messageSchema = z.object({
  deliveredAt: z.date().optional(),
  idSource: z.enum(["chat_db", "synthetic"]).optional(),
  isDelivered: z.boolean().optional(),
  isRead: z.boolean().optional(),
  isSent: z.boolean().optional(),
  partIndex: z.number().int().nonnegative().optional(),
  parentId: z.string().optional(),
  readAt: z.date().optional(),
});

export type IMessageMessage = SchemaMessage<
  typeof userSchema,
  typeof spaceSchema
> & {
  direction?: "inbound" | "outbound";
  deliveredAt?: Date;
  idSource?: "chat_db" | "synthetic";
  isDelivered?: boolean;
  isRead?: boolean;
  isSent?: boolean;
  partIndex?: number;
  parentId?: string;
  readAt?: Date;
};
