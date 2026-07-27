import { avatarColor, avatarInitials } from "@/lib/avatar-color";
import { cn } from "@/lib/utils";

export function UserAvatar({
  userId,
  name,
  avatarUrl,
  className,
  title,
}: {
  userId?: string;
  name: string;
  avatarUrl?: string | null;
  className?: string;
  title?: string;
}) {
  const color = avatarColor(userId || name);
  return (
    <span
      title={title ?? name}
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full text-[11px] font-semibold",
        !avatarUrl && color.bg,
        !avatarUrl && color.text,
        avatarUrl && "bg-muted",
        className,
      )}
    >
      {avatarUrl ? (
        <img src={avatarUrl} alt="" className="size-full object-cover" />
      ) : (
        avatarInitials(name)
      )}
    </span>
  );
}
