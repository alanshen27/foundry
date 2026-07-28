"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";

export function CreateWorkspaceForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const create = trpc.workspace.create.useMutation({
    onSuccess: (workspace) => {
      router.push(`/w/${workspace.slug}`);
      router.refresh();
    },
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (name.trim()) create.mutate({ name: name.trim() });
  }

  return (
    <Card className="gap-0 rounded-none p-0">
      <CardHeader className="border-b px-4 py-3">
        <CardTitle className="font-mono text-[13px] font-medium tracking-[0.04em] uppercase">
          New workspace
        </CardTitle>
        <CardDescription className="text-[12px]">
          A shared home for your team and product projects.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-4 py-4">
        <form onSubmit={onSubmit} className="flex gap-2.5">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Workspace name"
            aria-label="Workspace name"
            required
            className="rounded-none"
          />
          <Button type="submit" disabled={create.isPending} className="rounded-none font-mono uppercase tracking-[0.06em]">
            {create.isPending ? "Creating…" : "Create"}
          </Button>
        </form>
        {create.error ? (
          <p role="alert" className="text-destructive mt-2 text-[13px]">
            {create.error.message}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
