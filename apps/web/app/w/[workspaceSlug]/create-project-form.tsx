"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";

export function CreateProjectForm({
  workspaceId,
  workspaceSlug,
}: {
  workspaceId: string;
  workspaceSlug: string;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const create = trpc.project.create.useMutation({
    onSuccess: (project) => {
      router.push(`/w/${workspaceSlug}/projects/${project.slug}/overview`);
      router.refresh();
    },
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (name.trim()) {
      create.mutate({
        workspaceId,
        name: name.trim(),
        description: description.trim() || undefined,
      });
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-semibold tracking-wide uppercase">New project</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Project name"
            aria-label="Project name"
            required
          />
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="One-line description (optional)"
            aria-label="Project description"
          />
          <Button type="submit" disabled={create.isPending} className="self-start">
            {create.isPending ? "Creating…" : "Create project"}
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
