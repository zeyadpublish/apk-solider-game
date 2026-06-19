import { pgTable, integer, serial, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const leaderboardTable = pgTable("leaderboard", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id).unique(),
  kills: integer("kills").notNull().default(0),
  deaths: integer("deaths").notNull().default(0),
  matches: integer("matches").notNull().default(0),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type Leaderboard = typeof leaderboardTable.$inferSelect;
