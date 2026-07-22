"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
        router.push(nextParam ?? "/workspaces");
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
    <main className="flex min-h-screen items-center justify-center p-8">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">Create your FOUNDRY account</CardTitle>
          <CardDescription>Start building physical products with AI.</CardDescription>
        </CardHeader>
        <CardContent>
          {confirmSent ? (
            <div className="flex flex-col gap-4">
              <p className="text-sm">
                Check your inbox at <span className="font-medium">{email}</span> to confirm your
                account, then sign in.
              </p>
              <Button render={<Link href={signInHref} />}>Go to sign in</Button>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  autoComplete="name"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                  autoComplete="new-password"
                />
                <p className="text-muted-foreground text-xs">At least 8 characters.</p>
              </div>
              {error ? (
                <p role="alert" className="text-destructive text-sm">
                  {error}
                </p>
              ) : null}
              <Button type="submit" disabled={submitting}>
                {submitting ? "Creating account…" : "Create account"}
              </Button>
            </form>
          )}
          <p className="text-muted-foreground mt-4 text-center text-sm">
            Already have an account?{" "}
            <Link href={signInHref} className="text-foreground underline underline-offset-4">
              Sign in
            </Link>
          </p>
        </CardContent>
      </Card>
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
