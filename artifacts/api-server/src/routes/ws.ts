import type { WebSocket, WebSocketServer } from "ws";
import { db, sessionsTable, usersTable, leaderboardTable } from "@workspace/db";
import { eq, and, gt, sql } from "drizzle-orm";
import { logger } from "../lib/logger";

interface PlayerState {
  ws: WebSocket;
  username: string;
  userId: number;
  mission: string;
  mode: string;
  position: [number, number, number];
  health: number;
  lastSeen: number;
}

const players = new Map<string, PlayerState>();

async function authenticate(token: string): Promise<{ username: string; userId: number } | null> {
  try {
    const [session] = await db
      .select({ userId: sessionsTable.userId, expiresAt: sessionsTable.expiresAt })
      .from(sessionsTable)
      .where(and(eq(sessionsTable.token, token), gt(sessionsTable.expiresAt, new Date())))
      .limit(1);
    if (!session) return null;
    const [user] = await db
      .select({ username: usersTable.username, id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.id, session.userId))
      .limit(1);
    if (!user) return null;
    return { username: user.username, userId: user.id };
  } catch {
    return null;
  }
}

function broadcast(mission: string, exclude: string, msg: object) {
  const data = JSON.stringify(msg);
  for (const [id, p] of players) {
    if (id !== exclude && p.mission === mission && p.ws.readyState === 1) {
      try { p.ws.send(data); } catch { }
    }
  }
}

function broadcastRoster(mission: string) {
  const roster = [...players.values()]
    .filter(p => p.mission === mission)
    .map(p => ({
      username: p.username,
      position: p.position,
      health: p.health,
    }));
  const msg = JSON.stringify({ type: "roster", players: roster });
  for (const p of players.values()) {
    if (p.mission === mission && p.ws.readyState === 1) {
      try { p.ws.send(msg); } catch { }
    }
  }
}

async function recordKill(userId: number) {
  try {
    await db
      .insert(leaderboardTable)
      .values({ userId, kills: 1, deaths: 0, matches: 0 })
      .onConflictDoUpdate({
        target: leaderboardTable.userId,
        set: {
          kills: sql`${leaderboardTable.kills} + 1`,
          updatedAt: new Date(),
        },
      });
  } catch (err) {
    logger.error({ err }, "recordKill error");
  }
}

async function recordMatch(userId: number) {
  try {
    await db
      .insert(leaderboardTable)
      .values({ userId, kills: 0, deaths: 0, matches: 1 })
      .onConflictDoUpdate({
        target: leaderboardTable.userId,
        set: {
          matches: sql`${leaderboardTable.matches} + 1`,
          updatedAt: new Date(),
        },
      });
  } catch (err) {
    logger.error({ err }, "recordMatch error");
  }
}

export function attachWebSocket(wss: WebSocketServer) {
  wss.on("connection", async (ws: WebSocket, req) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const token = url.searchParams.get("token");

    if (!token) { ws.close(1008, "Missing token"); return; }

    const auth = await authenticate(token);
    if (!auth) { ws.close(1008, "Invalid token"); return; }

    const { username, userId } = auth;
    const id = `${username}_${Date.now()}`;
    const state: PlayerState = {
      ws, username, userId,
      mission: "training-base",
      mode: "multiplayer",
      position: [0, 0, 0],
      health: 100,
      lastSeen: Date.now(),
    };
    players.set(id, state);

    logger.info({ username }, "WebSocket player connected");

    ws.send(JSON.stringify({ type: "welcome", username }));
    broadcastRoster(state.mission);
    await recordMatch(userId);

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as Record<string, unknown>;
        const p = players.get(id);
        if (!p) return;
        p.lastSeen = Date.now();

        if (msg.type === "join") {
          const prevMission = p.mission;
          p.mission = (msg.mission as string) ?? p.mission;
          p.mode    = (msg.mode as string) ?? p.mode;
          broadcastRoster(prevMission);
          broadcastRoster(p.mission);
        } else if (msg.type === "position") {
          p.position = (msg.position as [number, number, number]) ?? p.position;
          p.health   = (msg.health as number) ?? p.health;
          broadcast(p.mission, id, {
            type: "player_moved",
            username: p.username,
            position: p.position,
            health: p.health,
          });
        } else if (msg.type === "kill") {
          broadcast(p.mission, id, {
            type: "kill_event",
            killer: p.username,
            role: msg.role,
          });
          // Record kill to leaderboard
          recordKill(p.userId).catch(() => {});
        } else if (msg.type === "duel_hit") {
          const amount = Math.max(1, Math.min(100, Number(msg.amount ?? 16)));
          broadcast(p.mission, id, {
            type: "duel_hit",
            attacker: p.username,
            amount,
          });
        } else if (msg.type === "chat") {
          const text = String(msg.text ?? "").slice(0, 200);
          broadcast(p.mission, id, { type: "chat", username: p.username, text });
          ws.send(JSON.stringify({ type: "chat", username: p.username, text }));
        } else if (msg.type === "ping") {
          ws.send(JSON.stringify({ type: "pong" }));
        }
      } catch { }
    });

    ws.on("close", () => {
      const p = players.get(id);
      if (p) {
        const mission = p.mission;
        players.delete(id);
        broadcastRoster(mission);
        logger.info({ username }, "WebSocket player disconnected");
      }
    });

    ws.on("error", () => { players.delete(id); });
  });

  setInterval(() => {
    const now = Date.now();
    for (const [id, p] of players) {
      if (now - p.lastSeen > 60_000) {
        p.ws.terminate();
        players.delete(id);
      }
    }
  }, 30_000);
}
