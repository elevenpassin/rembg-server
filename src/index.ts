import z from "zod";
import { db } from "./db.ts";
import { publicProcedure, router } from "./trpc.ts";
import { createHTTPServer } from "@trpc/server/adapters/standalone";

const appRouter = router({
	userList: publicProcedure.query(async () => {
		const users = await db.user.findMany();
		return users;
	}),
	userById: publicProcedure.input(z.int()).query(async (opts) => {
		const { input } = opts;

		const user = await db.user.findUnique({
			where: {
				id: input,
			},
		});

		return user;
	}),
});

export type AppRouter = typeof appRouter;

const server = createHTTPServer({
	router: appRouter,
});
server.listen(3000);
