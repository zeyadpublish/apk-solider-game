import { Router, type IRouter, type Request, type Response } from "express";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import { db, sessionsTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { authenticateRequest } from "../lib/auth";

const router: IRouter = Router();

function generateToken(): string {
  return randomBytes(48).toString("hex");
}

function sessionExpiry(): Date {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return d;
}

router.post("/signup", async (req: Request, res: Response) => {
  const { username, password } = req.body as { username?: string; password?: string };

  if (!username || !password) {
    res.status(400).json({ error: "Username and password are required" });
    return;
  }

  const trimmed = username.trim().toLowerCase();
  if (trimmed.length < 3 || trimmed.length > 20) {
    res.status(400).json({ error: "Username must be 3-20 characters" });
    return;
  }
  if (!/^[a-z0-9_]+$/.test(trimmed)) {
    res.status(400).json({ error: "Username may only contain letters, numbers, and underscores" });
    return;
  }
  if (password.length < 6) {
    res.status(400).json({ error: "Password must be at least 6 characters" });
    return;
  }

  try {
    const existing = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.username, trimmed))
      .limit(1);

    if (existing.length > 0) {
      res.status(409).json({ error: "Username is already taken" });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const [user] = await db
      .insert(usersTable)
      .values({ username: trimmed, passwordHash })
      .returning({ id: usersTable.id, username: usersTable.username });

    const token = generateToken();
    await db.insert(sessionsTable).values({
      userId: user.id,
      token,
      expiresAt: sessionExpiry(),
    });

    res.json({ token, username: user.username, user });
  } catch (err) {
    req.log.error({ err }, "Signup error");
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/login", async (req: Request, res: Response) => {
  const { username, password } = req.body as { username?: string; password?: string };

  if (!username || !password) {
    res.status(400).json({ error: "Username and password are required" });
    return;
  }

  const trimmed = username.trim().toLowerCase();

  try {
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.username, trimmed))
      .limit(1);

    if (!user) {
      res.status(401).json({ error: "Invalid username or password" });
      return;
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      res.status(401).json({ error: "Invalid username or password" });
      return;
    }

    const token = generateToken();
    await db.insert(sessionsTable).values({
      userId: user.id,
      token,
      expiresAt: sessionExpiry(),
    });

    res.json({
      token,
      username: user.username,
      user: { id: user.id, username: user.username },
    });
  } catch (err) {
    req.log.error({ err }, "Login error");
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/me", async (req: Request, res: Response) => {
  try {
    const user = await authenticateRequest(req);
    if (!user) {
      res.status(401).json({ error: "Invalid or expired session" });
      return;
    }

    res.json({ username: user.username, user });
  } catch (err) {
    req.log.error({ err }, "Me error");
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/logout", async (req: Request, res: Response) => {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (token) {
    try {
      await db.delete(sessionsTable).where(eq(sessionsTable.token, token));
    } catch {
      // Logout remains idempotent even if the DB session is already gone.
    }
  }
  res.json({ ok: true });
});

export default router;
