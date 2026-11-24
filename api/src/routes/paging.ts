import { Types } from "mongoose";
import { z } from "zod";

// Cursor paging: newest first, `before` is the id of the last row the client has.
const pagingQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  before: z
    .string()
    .refine((value) => Types.ObjectId.isValid(value), "must be an id")
    .optional(),
});

export function parsePaging(query: unknown) {
  const { limit, before } = pagingQuery.parse(query);
  return { limit, idFilter: before ? { _id: { $lt: new Types.ObjectId(before) } } : {} };
}
