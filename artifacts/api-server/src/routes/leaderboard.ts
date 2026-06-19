import { Router, type IRouter, type Request, type Response } from "express";
import { db, leaderboardTable, usersTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";

const router: IRouter = Router();

// Simple 30-second in-memory cache
let cache: { data: unknown; at: number } | null = null;
const CACHE_TTL = 30_000;

router.get("/", async (_req: Request, res: Response) => {
  if (cache && Date.now() - cache.at < CACHE_TTL) {
    res.json(cache.data);
    return;
  }
  try {
    const rows = await db
      .select({
        username: usersTable.username,
        kills: leaderboardTable.kills,
        deaths: leaderboardTable.deaths,
        matches: leaderboardTable.matches,
      })
      .from(leaderboardTable)
      .innerJoin(usersTable, eq(leaderboardTable.userId, usersTable.id))
      .orderBy(desc(leaderboardTable.kills))
      .limit(20);

    const data = { players: rows };
    cache = { data, at: Date.now() };
    res.json(data);
  } catch (err) {
    _req.log.error({ err }, "Leaderboard fetch error");
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
export { cache as leaderboardCache };
