import { integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const friendshipsTable = pgTable(
  "friendships",
  {
    id: serial("id").primaryKey(),
    requesterId: integer("requester_id").notNull().references(() => usersTable.id),
    addresseeId: integer("addressee_id").notNull().references(() => usersTable.id),
    status: text("status").notNull().default("pending"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    pairUnique: uniqueIndex("friendships_requester_addressee_unique").on(
      table.requesterId,
      table.addresseeId,
    ),
  }),
);

export const friendChallengesTable = pgTable("friend_challenges", {
  id: serial("id").primaryKey(),
  challengerId: integer("challenger_id").notNull().references(() => usersTable.id),
  challengedId: integer("challenged_id").notNull().references(() => usersTable.id),
  mission: text("mission").notNull().default("uae-war-city"),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type Friendship = typeof friendshipsTable.$inferSelect;
export type FriendChallenge = typeof friendChallengesTable.$inferSelect;
