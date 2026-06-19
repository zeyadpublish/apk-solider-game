import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  friendChallengesTable,
  friendshipsTable,
  usersTable,
  type Friendship,
} from "@workspace/db";
import { and, eq, ilike, inArray, ne, or } from "drizzle-orm";
import { authenticateRequest, type AuthUser } from "../lib/auth";

const router: IRouter = Router();

type FriendUser = { id: number; username: string };

function publicUser(user: FriendUser) {
  return { id: user.id, username: user.username };
}

async function requireUser(req: Request, res: Response): Promise<AuthUser | null> {
  const user = await authenticateRequest(req);
  if (!user) {
    res.status(401).json({ error: "Invalid or expired session" });
    return null;
  }
  return user;
}

async function usersById(ids: number[]): Promise<Map<number, FriendUser>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: usersTable.id, username: usersTable.username })
    .from(usersTable)
    .where(inArray(usersTable.id, [...new Set(ids)]));
  return new Map(rows.map((row) => [row.id, row]));
}

function otherUserId(row: Friendship, userId: number): number {
  return row.requesterId === userId ? row.addresseeId : row.requesterId;
}

async function friendshipBetween(userId: number, otherId: number) {
  const [row] = await db
    .select()
    .from(friendshipsTable)
    .where(
      or(
        and(eq(friendshipsTable.requesterId, userId), eq(friendshipsTable.addresseeId, otherId)),
        and(eq(friendshipsTable.requesterId, otherId), eq(friendshipsTable.addresseeId, userId)),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function acceptedFriendship(userId: number, otherId: number) {
  const row = await friendshipBetween(userId, otherId);
  return row?.status === "accepted" ? row : null;
}

router.get("/", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;

  try {
    const friendships = await db
      .select()
      .from(friendshipsTable)
      .where(or(eq(friendshipsTable.requesterId, user.id), eq(friendshipsTable.addresseeId, user.id)));
    const users = await usersById(friendships.map((row) => otherUserId(row, user.id)));

    const accepted = friendships
      .filter((row) => row.status === "accepted")
      .map((row) => ({
        id: row.id,
        friend: publicUser(users.get(otherUserId(row, user.id)) ?? { id: otherUserId(row, user.id), username: "unknown" }),
        createdAt: row.createdAt,
      }));

    const incoming = friendships
      .filter((row) => row.status === "pending" && row.addresseeId === user.id)
      .map((row) => ({
        id: row.id,
        from: publicUser(users.get(row.requesterId) ?? { id: row.requesterId, username: "unknown" }),
        createdAt: row.createdAt,
      }));

    const outgoing = friendships
      .filter((row) => row.status === "pending" && row.requesterId === user.id)
      .map((row) => ({
        id: row.id,
        to: publicUser(users.get(row.addresseeId) ?? { id: row.addresseeId, username: "unknown" }),
        createdAt: row.createdAt,
      }));

    const challenges = await db
      .select()
      .from(friendChallengesTable)
      .where(
        and(
          eq(friendChallengesTable.status, "pending"),
          or(
            eq(friendChallengesTable.challengerId, user.id),
            eq(friendChallengesTable.challengedId, user.id),
          ),
        ),
      );
    const challengeUsers = await usersById(
      challenges.flatMap((row) => [row.challengerId, row.challengedId]).filter((id) => id !== user.id),
    );

    res.json({
      friends: accepted,
      incoming,
      outgoing,
      challenges: challenges.map((row) => ({
        id: row.id,
        mission: row.mission,
        status: row.status,
        direction: row.challengerId === user.id ? "outgoing" : "incoming",
        friend: publicUser(
          challengeUsers.get(row.challengerId === user.id ? row.challengedId : row.challengerId) ?? {
            id: row.challengerId === user.id ? row.challengedId : row.challengerId,
            username: "unknown",
          },
        ),
        createdAt: row.createdAt,
      })),
    });
  } catch (err) {
    req.log.error({ err }, "Friends list error");
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/search", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const q = String(req.query.q ?? "").trim().toLowerCase();
  if (q.length < 2) {
    res.json({ users: [] });
    return;
  }

  try {
    const rows = await db
      .select({ id: usersTable.id, username: usersTable.username })
      .from(usersTable)
      .where(and(ilike(usersTable.username, `%${q}%`), ne(usersTable.id, user.id)))
      .limit(12);

    const friendships = await Promise.all(rows.map((row) => friendshipBetween(user.id, row.id)));
    res.json({
      users: rows.map((row, index) => ({
        ...publicUser(row),
        friendshipStatus: friendships[index]?.status ?? null,
        friendshipId: friendships[index]?.id ?? null,
      })),
    });
  } catch (err) {
    req.log.error({ err }, "Friend search error");
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/request", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const username = String((req.body as { username?: string }).username ?? "").trim().toLowerCase();
  if (!username) {
    res.status(400).json({ error: "Friend username is required" });
    return;
  }

  try {
    const [target] = await db
      .select({ id: usersTable.id, username: usersTable.username })
      .from(usersTable)
      .where(eq(usersTable.username, username))
      .limit(1);

    if (!target) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    if (target.id === user.id) {
      res.status(400).json({ error: "You cannot add yourself" });
      return;
    }

    const existing = await friendshipBetween(user.id, target.id);
    if (existing) {
      res.json({ friendship: existing, friend: publicUser(target) });
      return;
    }

    const [friendship] = await db
      .insert(friendshipsTable)
      .values({ requesterId: user.id, addresseeId: target.id, status: "pending" })
      .returning();

    res.status(201).json({ friendship, friend: publicUser(target) });
  } catch (err) {
    req.log.error({ err }, "Friend request error");
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/:friendshipId/respond", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const friendshipId = Number(req.params.friendshipId);
  const action = String((req.body as { action?: string }).action ?? "");
  if (!Number.isInteger(friendshipId) || !["accept", "reject"].includes(action)) {
    res.status(400).json({ error: "Valid friendship id and action are required" });
    return;
  }

  try {
    const [friendship] = await db
      .update(friendshipsTable)
      .set({ status: action === "accept" ? "accepted" : "rejected", updatedAt: new Date() })
      .where(
        and(
          eq(friendshipsTable.id, friendshipId),
          eq(friendshipsTable.addresseeId, user.id),
          eq(friendshipsTable.status, "pending"),
        ),
      )
      .returning();

    if (!friendship) {
      res.status(404).json({ error: "Pending request not found" });
      return;
    }

    res.json({ friendship });
  } catch (err) {
    req.log.error({ err }, "Friend response error");
    res.status(500).json({ error: "Server error" });
  }
});

router.delete("/:friendshipId", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const friendshipId = Number(req.params.friendshipId);
  if (!Number.isInteger(friendshipId)) {
    res.status(400).json({ error: "Valid friendship id is required" });
    return;
  }

  try {
    await db
      .delete(friendshipsTable)
      .where(
        and(
          eq(friendshipsTable.id, friendshipId),
          or(eq(friendshipsTable.requesterId, user.id), eq(friendshipsTable.addresseeId, user.id)),
        ),
      );
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Friend delete error");
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/challenge", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const friendId = Number((req.body as { friendId?: number }).friendId);
  const mission = String((req.body as { mission?: string }).mission ?? "uae-war-city").slice(0, 80);
  if (!Number.isInteger(friendId) || friendId === user.id) {
    res.status(400).json({ error: "Valid friend id is required" });
    return;
  }

  try {
    const friendship = await acceptedFriendship(user.id, friendId);
    if (!friendship) {
      res.status(403).json({ error: "Challenges can only be sent to accepted friends" });
      return;
    }

    const [challenge] = await db
      .insert(friendChallengesTable)
      .values({
        challengerId: user.id,
        challengedId: friendId,
        mission,
        status: "pending",
      })
      .returning();

    res.status(201).json({ challenge });
  } catch (err) {
    req.log.error({ err }, "Challenge create error");
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/challenge/:challengeId/respond", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const challengeId = Number(req.params.challengeId);
  const action = String((req.body as { action?: string }).action ?? "");
  if (!Number.isInteger(challengeId) || !["accept", "decline"].includes(action)) {
    res.status(400).json({ error: "Valid challenge id and action are required" });
    return;
  }

  try {
    const [challenge] = await db
      .update(friendChallengesTable)
      .set({ status: action === "accept" ? "accepted" : "declined", updatedAt: new Date() })
      .where(
        and(
          eq(friendChallengesTable.id, challengeId),
          eq(friendChallengesTable.challengedId, user.id),
          eq(friendChallengesTable.status, "pending"),
        ),
      )
      .returning();

    if (!challenge) {
      res.status(404).json({ error: "Pending challenge not found" });
      return;
    }

    await db
      .delete(friendChallengesTable)
      .where(eq(friendChallengesTable.id, challenge.id));

    res.json({ challenge });
  } catch (err) {
    req.log.error({ err }, "Challenge response error");
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
