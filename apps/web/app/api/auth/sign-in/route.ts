import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { prisma } from "@foundry/db";
import { getServerEnv } from "@foundry/config";
import {
  createSessionToken,
  createSupabaseAuthAdapter,
  LOCAL_SESSION_COOKIE,
  verifyPassword,
} from "@foundry/auth";
import { upsertSupabaseUser } from "@/server/session";

const bodySchema = z.object({ email: z.string().email(), password: z.string().min(1) });

export async function POST(request: Request) {
  const env = getServerEnv();
  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const { email, password } = parsed.data;

  if (env.AUTH_MODE === "local") {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user?.localPasswordHash || !verifyPassword(password, user.localPasswordHash)) {
      return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
    }
    const response = NextResponse.json({ ok: true });
    response.cookies.set(
      LOCAL_SESSION_COOKIE,
      createSessionToken(user.id, email, env.AUTH_SECRET!),
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
  const identity = await auth.signInWithPassword(email, password);
  if (!identity) {
    return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
  }
  await upsertSupabaseUser(identity);
  const response = NextResponse.json({ ok: true });
  for (const cookie of pendingCookies) {
    response.cookies.set(cookie.name, cookie.value, cookie.options as never);
  }
  return response;
}
