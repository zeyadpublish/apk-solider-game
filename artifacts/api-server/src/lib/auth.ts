import type { Request } from "express";
import { and, eq, gt } from "drizzle-orm";
import { db, sessionsTable, usersTable } from "@workspace/db";

export interface AuthUser {
  id: number;
  username: string;
}

export function readBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) return null;
  return token;
}

export async function authenticateRequest(req: Request): Promise<AuthUser | null> {
  const token = readBearerToken(req);
  if (!token) return null;

  const [session] = await db
    .select({ userId: sessionsTable.userId, expiresAt: sessionsTable.expiresAt })
    .from(sessionsTable)
    .where(and(eq(sessionsTable.token, token), gt(sessionsTable.expiresAt, new Date())))
    .limit(1);

  if (!session) return null;

  const [user] = await db
    .select({ id: usersTable.id, username: usersTable.username })
    .from(usersTable)
    .where(eq(usersTable.id, session.userId))
    .limit(1);

  return user ?? null;
}
