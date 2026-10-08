import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import prisma from "./client";

async function main() {
  // No hardcoded default — without an explicit argument, generate a strong
  // random password and print it once to stdout.
  const newPw =
    process.argv[2] ||
    randomBytes(18).toString("base64url").replace(/[/+=]/g, "").slice(0, 20);
  const hash = await bcrypt.hash(newPw, 10);
  await prisma.user.update({
    where: { username: "admin" },
    data: { passwordHash: hash, passwordMustChange: true },
  });
  console.log(`Admin password reset to "${newPw}".`);
  console.log("passwordMustChange set to true — user will be forced to change it on first login.");
}

main().finally(() => prisma.$disconnect());
