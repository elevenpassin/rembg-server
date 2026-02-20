import { db } from "./db.ts";
import { publicProcedure, router } from "./trpc.ts";

const appRouter = router({
	userList: publicProcedure.query(async () => {
		const users = await db.user.findMany();
		return users;
	}),
});

export type AppRouter = typeof appRouter;
