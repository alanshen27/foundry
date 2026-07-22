"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-semibold tracking-wide uppercase">
          New workspace
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex gap-3">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Workspace name"
            aria-label="Workspace name"
            required
          />
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? "Creating…" : "Create"}
          </Button>
        </form>
        {create.error ? (
          <p role="alert" className="text-destructive mt-2 text-sm">
            {create.error.message}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
