"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";
import { AuthShell } from "@/components/auth-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function SignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(() => {
    if (searchParams.get("error") === "confirm") {
      return searchParams.get("message") || "Email confirmation failed. Try signing in, or request a new link.";
    }
    return null;
  });
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    const response = await fetch("/api/auth/sign-in", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (response.ok) {
      router.push(searchParams.get("next") ?? "/");
      router.refresh();
    } else {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? "Sign-in failed");
      setSubmitting(false);
    }
  }

  return (
    <AuthShell
      code="Auth / 01"
      title="Sign in"
      subtitle="Use your account email and password."
      glyphSeed="auth-sign-in"
    >
      <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4">
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
            autoComplete="current-password"
            className="rounded-none"
          />
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
          {submitting ? "Signing in…" : "Sign in"}
        </Button>
      </form>
      <p className="text-muted-foreground mt-5 text-center text-sm">
        Don&apos;t have an account?{" "}
        <Link
          href={
            searchParams.get("next")
              ? `/auth/sign-up?next=${encodeURIComponent(searchParams.get("next")!)}`
              : "/auth/sign-up"
          }
          className="text-foreground underline underline-offset-4"
        >
          Create one
        </Link>
      </p>
    </AuthShell>
  );
}

export default function SignInPage() {
  return (
    <Suspense>
      <SignInForm />
    </Suspense>
  );
}
