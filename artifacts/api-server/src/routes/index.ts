import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import leaderboardRouter from "./leaderboard";
import friendsRouter from "./friends";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/auth", authRouter);
router.use("/leaderboard", leaderboardRouter);
router.use("/friends", friendsRouter);

export default router;
