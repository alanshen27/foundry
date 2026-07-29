"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { UserAvatar } from "@/components/user-avatar";
import { trpc } from "@/lib/trpc";

const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Failed to read file"));
        return;
      }
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

export function ProfileForm({
  user,
}: {
  user: { id: string; email: string; name: string; avatarUrl: string | null };
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(user.name);
  const [avatarUrl, setAvatarUrl] = useState(user.avatarUrl);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const updateProfile = trpc.user.updateProfile.useMutation({
    onSuccess: (next) => {
      setName(next.name);
      setSaved(true);
      router.refresh();
    },
    onError: (err) => setError(err.message),
  });

  const uploadAvatar = trpc.user.uploadAvatar.useMutation({
    onSuccess: (next) => {
      setAvatarUrl(next.avatarUrl);
      setPreviewUrl(null);
      setSaved(true);
      router.refresh();
    },
    onError: (err) => setError(err.message),
  });

  const clearAvatar = trpc.user.clearAvatar.useMutation({
    onSuccess: (next) => {
      setAvatarUrl(next.avatarUrl);
      setPreviewUrl(null);
      setSaved(true);
      router.refresh();
    },
    onError: (err) => setError(err.message),
  });

  const busy = updateProfile.isPending || uploadAvatar.isPending || clearAvatar.isPending;
  const displayUrl = previewUrl ?? avatarUrl;

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSaved(false);
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Name is required");
      return;
    }
    updateProfile.mutate({ name: trimmed });
  }

  async function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setError(null);
    setSaved(false);

    if (!(ACCEPTED_TYPES as readonly string[]).includes(file.type)) {
      setError("Use a PNG, JPEG, or WebP image");
      return;
    }
    if (file.size > 2_000_000) {
      setError("Image must be under 2 MB");
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return objectUrl;
    });

    try {
      const contentBase64 = await fileToBase64(file);
      uploadAvatar.mutate({
        mimeType: file.type as (typeof ACCEPTED_TYPES)[number],
        contentBase64,
      });
    } catch {
      setError("Could not read that image");
      setPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h2 className="text-muted-foreground mb-3 font-mono text-[11px] font-medium tracking-[0.1em] uppercase">
          Photo
        </h2>
        <Card className="gap-0 rounded-none p-4">
          <div className="flex flex-wrap items-center gap-4">
            <UserAvatar
              userId={user.id}
              name={name.trim() || user.name}
              avatarUrl={displayUrl}
              className="size-16 text-base"
            />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <p className="text-muted-foreground text-[13px]">
                PNG, JPEG, or WebP up to 2 MB. Shown across workspaces and presence.
              </p>
              <div className="flex flex-wrap gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={ACCEPTED_TYPES.join(",")}
                  className="sr-only"
                  onChange={onFileChange}
                />
                <Button
                  type="button"
                  variant="outline"
                  className="rounded-none font-mono text-[11px] uppercase tracking-[0.08em]"
                  disabled={busy}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {uploadAvatar.isPending ? "Uploading…" : "Upload photo"}
                </Button>
                {avatarUrl || previewUrl ? (
                  <Button
                    type="button"
                    variant="ghost"
                    className="rounded-none font-mono text-[11px] uppercase tracking-[0.08em]"
                    disabled={busy}
                    onClick={() => {
                      setError(null);
                      setSaved(false);
                      clearAvatar.mutate();
                    }}
                  >
                    Remove
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        </Card>
      </section>

      <section>
        <h2 className="text-muted-foreground mb-3 font-mono text-[11px] font-medium tracking-[0.1em] uppercase">
          Profile
        </h2>
        <Card className="gap-0 rounded-none p-4">
          <form onSubmit={onSubmit} className="flex max-w-md flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="name" className="font-mono text-[11px] tracking-[0.1em] uppercase">
                Display name
              </Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setSaved(false);
                }}
                required
                maxLength={80}
                autoComplete="name"
                className="rounded-none"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="email" className="font-mono text-[11px] tracking-[0.1em] uppercase">
                Email
              </Label>
              <Input id="email" type="email" value={user.email} disabled className="rounded-none" />
              <p className="text-muted-foreground text-[12px]">
                Email is managed by your sign-in provider.
              </p>
            </div>
            {error ? (
              <p role="alert" className="text-destructive font-mono text-sm">
                {error}
              </p>
            ) : null}
            {saved && !error ? (
              <p className="font-mono text-sm text-emerald-600 dark:text-emerald-400">Saved</p>
            ) : null}
            <Button
              type="submit"
              disabled={busy || name.trim() === user.name}
              className="w-fit rounded-none font-mono uppercase tracking-[0.08em]"
            >
              {updateProfile.isPending ? "Saving…" : "Save name"}
            </Button>
          </form>
        </Card>
      </section>
    </div>
  );
}
