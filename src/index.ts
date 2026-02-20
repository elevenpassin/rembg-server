import { router, publicProcedure } from "./trpc.ts";
import { db } from './db.ts'


const appRouter = router({
  userList: publicProcedure.query(async () => {
    const users = await db.user.findMany()
    return users
  })
})

export type AppRouter = typeof appRouter
