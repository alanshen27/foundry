"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";
import { FoundryMark } from "@/components/foundry-mark";
import { SignalGlyph } from "@/components/signal-glyph";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function SignUpForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirmSent, setConfirmSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const nextParam = searchParams.get("next");
  const signInHref = nextParam ? `/auth/sign-in?next=${encodeURIComponent(nextParam)}` : "/auth/sign-in";

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    const response = await fetch("/api/auth/sign-up", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password }),
    });
    if (response.ok) {
      const body = (await response.json().catch(() => null)) as { signedIn?: boolean } | null;
      if (body?.signedIn) {
        router.push(nextParam ?? "/");
        router.refresh();
      } else {
        setConfirmSent(true);
        setSubmitting(false);
      }
    } else {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? "Sign-up failed");
      setSubmitting(false);
    }
  }

  return (
    <main className="bg-dot-grid flex min-h-screen items-center justify-center p-6">
      <div className="border-border bg-card w-full max-w-md border">
        <div className="border-border flex items-center justify-between border-b px-5 py-4">
          <FoundryMark />
          <span className="text-muted-foreground font-mono text-[10px] tracking-[0.16em] uppercase">
            Auth / 02
          </span>
        </div>
        <div className="bg-primary text-[#faf9f5] relative h-24 overflow-hidden">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-[0.28]"
            style={{
              backgroundImage: "radial-gradient(circle, #faf9f5 0.7px, transparent 0.8px)",
              backgroundSize: "4px 4px",
            }}
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-[0.16]"
            style={{
              backgroundImage: "radial-gradient(circle, #faf9f5 1.15px, transparent 1.25px)",
              backgroundSize: "9px 9px",
              backgroundPosition: "2px 2px",
            }}
          />
          <div className="absolute inset-0 flex items-center justify-center">
            <SignalGlyph
              seed="auth-sign-up"
              rows={10}
              cols={48}
              monoClassName="text-[7px] leading-[1.02] tracking-[0.12em]"
            />
          </div>
        </div>
        <div className="px-5 py-6">
          <h1 className="font-mono text-xl font-medium tracking-[-0.03em]">Create account</h1>
          <p className="text-muted-foreground mt-1 text-[13px]">
            Start building physical products with AI.
          </p>
          {confirmSent ? (
            <div className="mt-6 flex flex-col gap-4">
              <p className="text-sm">
                Check your inbox at <span className="font-medium">{email}</span> to confirm your
                account, then sign in.
              </p>
              <Button
                nativeButton={false}
                render={<Link href={signInHref} />}
                className="rounded-none font-mono uppercase tracking-[0.08em]"
              >
                Go to sign in
              </Button>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="name" className="font-mono text-[11px] tracking-[0.1em] uppercase">
                  Name
                </Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  autoComplete="name"
                  className="rounded-none"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="email" className="font-mono text-[11px] tracking-[0.1em] uppercase">
                  Email
                </Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  className="rounded-none"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="password" className="font-mono text-[11px] tracking-[0.1em] uppercase">
                  Password
                </Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                  autoComplete="new-password"
                  className="rounded-none"
                />
                <p className="text-muted-foreground font-mono text-[11px]">At least 8 characters.</p>
              </div>
              {error ? (
                <p role="alert" className="text-destructive font-mono text-sm">
                  {error}
                </p>
              ) : null}
              <Button type="submit" disabled={submitting} className="rounded-none font-mono uppercase tracking-[0.08em]">
                {submitting ? "Creating account…" : "Create account"}
              </Button>
            </form>
          )}
          <p className="text-muted-foreground mt-5 text-center text-sm">
            Already have an account?{" "}
            <Link href={signInHref} className="text-foreground underline underline-offset-4">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}

export default function SignUpPage() {
  return (
    <Suspense>
      <SignUpForm />
    </Suspense>
  );
}
