import "server-only";
import { mintCollabToken, type CollabClaims } from "@foundry/collaboration";
import { getServerEnv } from "@foundry/config";

function secretMaterial(): string {
  const env = getServerEnv();
  return env.AUTH_SECRET ?? env.DATABASE_URL;
}

export function mintCodeFileCollabToken(
  claims: Omit<CollabClaims, "exp" | "kind"> & { resourceId: string },
): string {
  return mintCollabToken({ ...claims, kind: "codefile" }, secretMaterial());
}

export function mintSitePromptCollabToken(
  claims: Omit<CollabClaims, "exp" | "kind"> & { resourceId: string },
): string {
  return mintCollabToken({ ...claims, kind: "siteprompt" }, secretMaterial());
}

export function getCollabWebsocketUrl(): string | null {
  return getServerEnv().NEXT_PUBLIC_COLLAB_URL ?? null;
}
