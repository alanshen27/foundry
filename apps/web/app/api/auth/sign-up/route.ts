import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { prisma } from "@foundry/db";
import { getServerEnv } from "@foundry/config";
import {
  createSessionToken,
  createSupabaseAuthAdapter,
  hashPassword,
  LOCAL_SESSION_COOKIE,
} from "@foundry/auth";
import { authCallbackUrl } from "@/server/auth-redirect";
import { createWorkspaceForOwner, defaultWorkspaceName } from "@/server/create-workspace";
import { upsertSupabaseUser } from "@/server/session";

const bodySchema = z.object({
  name: z.string().trim().min(1).max(80),
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export async function POST(request: Request) {
  const env = getServerEnv();
  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Invalid request";
    return NextResponse.json({ error: message }, { status: 400 });
  }
  const { name, email, password } = parsed.data;

  if (env.AUTH_MODE === "local") {
    if (!env.AUTH_SECRET) {
      return NextResponse.json({ error: "AUTH_SECRET is not configured" }, { status: 500 });
    }
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return NextResponse.json(
        { error: "An account with this email already exists" },
        {
          status: 409,
        },
      );
    }
    const user = await prisma.user.create({
      data: { email, name, localPasswordHash: hashPassword(password) },
    });
    await createWorkspaceForOwner({
      userId: user.id,
      name: defaultWorkspaceName(name),
    });
    const response = NextResponse.json({ ok: true, signedIn: true });
    response.cookies.set(
      LOCAL_SESSION_COOKIE,
      createSessionToken(user.id, email, env.AUTH_SECRET),
      {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: process.env.NODE_ENV === "production",
      },
    );
    return response;
  }

  const cookieStore = await cookies();
  const pendingCookies: { name: string; value: string; options?: Record<string, unknown> }[] = [];
  const auth = createSupabaseAuthAdapter({
    url: env.NEXT_PUBLIC_SUPABASE_URL!,
    anonKey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookies) => pendingCookies.push(...cookies),
    },
  });

  const origin = env.APP_ORIGIN?.replace(/\/$/, "") || new URL(request.url).origin;
  const result = await auth.signUpWithPassword(email, password, name, {
    emailRedirectTo: authCallbackUrl(origin),
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  await upsertSupabaseUser(result.identity);

  if (!result.hasSession) {
    // Email confirmation required before a session is issued.
    return NextResponse.json({ ok: true, signedIn: false });
  }

  const response = NextResponse.json({ ok: true, signedIn: true });
  for (const cookie of pendingCookies) {
    response.cookies.set(cookie.name, cookie.value, cookie.options as never);
  }
  return response;
}
