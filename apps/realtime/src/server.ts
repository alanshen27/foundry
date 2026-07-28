/**
 * Yjs collaboration server (Hocuspocus).
 *
 * Rooms:
 *   codefile:{fileId}   — Engineer > Code Monaco (persisted to CodeFile.content)
 *   siteprompt:{siteId} — Site editor shared revision-prompt draft (ephemeral)
 *
 * Auth: short-lived HMAC tokens minted by apps/web tRPC collaboration.*.
 *
 * Run: pnpm --filter @foundry/collab-server dev
 */
import { Server } from "@hocuspocus/server";
import {
  MONACO_YTEXT_KEY,
  parseCodeFileRoom,
  parseSitePromptRoom,
  verifyCollabToken,
  type CollabClaims,
} from "@foundry/collaboration";
import { getServerEnv } from "@foundry/config";
import { prisma } from "@foundry/db";

type CollabContext = {
  claims: CollabClaims;
};

function secretMaterial(): string {
  const env = getServerEnv();
  return env.AUTH_SECRET ?? env.DATABASE_URL;
}

function resourceMatchesRoom(claims: CollabClaims, documentName: string): boolean {
  if (claims.kind === "codefile") {
    const fileId = parseCodeFileRoom(documentName);
    return Boolean(fileId && fileId === claims.resourceId);
  }
  if (claims.kind === "siteprompt") {
    const siteId = parseSitePromptRoom(documentName);
    return Boolean(siteId && siteId === claims.resourceId);
  }
  return false;
}

const port = Number(process.env.COLLAB_PORT ?? "1234");

const server = Server.configure({
  port,
  async onAuthenticate({ token, documentName, connection }) {
    if (!token || typeof token !== "string") {
      throw new Error("Missing collaboration token");
    }
    const claims = verifyCollabToken(token, secretMaterial());
    if (!claims) {
      throw new Error("Invalid or expired collaboration token");
    }
    if (!resourceMatchesRoom(claims, documentName)) {
      throw new Error("Token does not match document");
    }
    if (!claims.canEdit) {
      connection.readOnly = true;
    }
    return { claims } satisfies CollabContext;
  },

  async onLoadDocument({ document, documentName }) {
    const fileId = parseCodeFileRoom(documentName);
    if (!fileId) {
      // siteprompt rooms are ephemeral drafts — start empty.
      return;
    }

    const ytext = document.getText(MONACO_YTEXT_KEY);
    if (ytext.length > 0) return;

    const file = await prisma.codeFile.findUnique({
      where: { id: fileId },
      select: { content: true },
    });
    if (file?.content) {
      ytext.insert(0, file.content);
    }
  },

  async onStoreDocument({ document, documentName, context }) {
    const fileId = parseCodeFileRoom(documentName);
    if (!fileId) {
      // Do not persist site prompt drafts — they are session scratchpads.
      return;
    }

    const claims = (context as CollabContext | undefined)?.claims;
    const content = document.getText(MONACO_YTEXT_KEY).toString();
    if (content.length > 400_000) {
      console.warn(`[collab] refusing to store oversized doc ${documentName}`);
      return;
    }

    await prisma.codeFile.update({
      where: { id: fileId },
      data: {
        content,
        ...(claims?.userId ? { updatedById: claims.userId } : {}),
      },
    });
  },
});

await server.listen();
console.log(`[collab] Hocuspocus listening on ws://localhost:${port}`);
