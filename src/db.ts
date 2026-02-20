import process from "node:process";
import { fileURLToPath } from "node:url";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { PrismaClient } from "./generated/prisma/client.ts";
import "dotenv/config";

const connectionString = `${process.env.DATABASE_URL}`;

const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
export const prisma = new PrismaClient({ adapter });
export const db = prisma;

async function main() {
	const user = await prisma.user.create({
		data: {
			name: "Alice",
			email: "alice@prisma.io",
		},
	});
	console.log("Created user:", user);
	// Fetch all users with their posts
	const allUsers = await prisma.user.findMany({
		include: {
			bookmarks: true,
		},
	});
	console.log("All users:", JSON.stringify(allUsers, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	main()
		.then(async () => {
			await prisma.$disconnect();
		})
		.catch(async (e) => {
			console.error(e);
			await prisma.$disconnect();
			process.exit(1);
		});
}
