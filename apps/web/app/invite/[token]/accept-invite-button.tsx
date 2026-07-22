"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";

export function AcceptInviteButton({ token }: { token: string }) {
  const router = useRouter();
  const accept = trpc.workspace.acceptInvitation.useMutation({
    onSuccess: ({ workspaceSlug }) => {
      router.push(`/w/${workspaceSlug}`);
      router.refresh();
    },
  });

  return (
    <div>
      <Button onClick={() => accept.mutate({ token })} disabled={accept.isPending}>
        {accept.isPending ? "Joining…" : "Accept invitation"}
      </Button>
      {accept.error ? (
        <p role="alert" className="text-destructive mt-3 text-sm">
          {accept.error.message}
        </p>
      ) : null}
    </div>
  );
}
