import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { db } from "@/lib/db";
import { apiError } from "@/lib/http";
import { hashToken, newSessionToken, verifyPassword } from "@/lib/security";
import { SESSION_COOKIE } from "@/lib/auth";

const inputSchema = z.object({ email: z.email().transform(value => value.toLowerCase()), password: z.string().min(1).max(256) });

export async function POST(request: Request) {
  try {
    const input = inputSchema.parse(await request.json());
    const user = await db.user.findFirst({ where: { email: input.email, status: "ACTIVE" }, include: { facility: true, roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } } });
    if (!user || !verifyPassword(input.password, user.passwordHash)) return NextResponse.json({ error: "The email or password is incorrect" }, { status: 401 });
    const token = newSessionToken();
    const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000);
    await db.session.create({ data: { userId: user.id, tokenHash: hashToken(token), expiresAt, userAgent: request.headers.get("user-agent")?.slice(0, 300) } });
    (await cookies()).set(SESSION_COOKIE, token, { httpOnly: true, secure: true, sameSite: "strict", path: "/", expires: expiresAt });
    const permissions = [...new Set(user.roles.flatMap(item => item.role.permissions.map(value => value.permission.code)))];
    return NextResponse.json({ user: { email: user.email, displayName: user.displayName, facility: { id: user.facility.id, code: user.facility.code, name: user.facility.name }, roles: user.roles.map(item => item.role.code), permissions }, expiresAt });
  } catch (error) { return apiError(error); }
}
