"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";
import { AuthShell } from "@/components/auth-shell";
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
  const signInHref = nextParam
    ? `/auth/sign-in?next=${encodeURIComponent(nextParam)}`
    : "/auth/sign-in";

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
    <AuthShell
      code="Auth / 02"
      title={confirmSent ? "Check your inbox" : "Create account"}
      subtitle={
        confirmSent
          ? "Confirm the signal, then sign in."
          : "Start building physical products with AI."
      }
      glyphSeed={confirmSent ? "auth-confirm" : "auth-sign-up"}
    >
      {confirmSent ? (
        <div className="mt-6 flex flex-col gap-4">
          <div className="border-border bg-secondary/60 border px-4 py-3">
            <p className="font-mono text-[11px] tracking-[0.14em] uppercase opacity-70">
              Pending verification
            </p>
            <p className="mt-2 text-sm leading-relaxed">
              We sent a confirmation link to{" "}
              <span className="font-mono font-medium">{email}</span>. Open it to
              activate your account, then sign in.
            </p>
          </div>
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
          <Button
            type="submit"
            disabled={submitting}
            className="rounded-none font-mono uppercase tracking-[0.08em]"
          >
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
    </AuthShell>
  );
}

export default function SignUpPage() {
  return (
    <Suspense>
      <SignUpForm />
    </Suspense>
  );
}
