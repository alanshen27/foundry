/** Authenticated Yjs rooms with durable state and an atomic SQL read model. */
import { Server } from "@hocuspocus/server";
import * as Y from "yjs";
import { parseSitePromptRoom, verifyCollabToken, type CollabClaims } from "@foundry/collaboration";
import {
  authorizeCollaborationRoom,
  commitCollaborationUpdate,
  loadCollaborationDocument,
  publishCollaborationUpdate,
  readCollaborationState,
  subscribeCollaborationUpdates,
} from "@foundry/collaboration/server";
import { getServerEnv } from "@foundry/config";
import { createLogger } from "@foundry/observability";
import { initObservability } from "@foundry/observability/sentry";
import { readDocumentUpdate } from "./protocol";

const observability = initObservability({
  service: "foundry-collab",
  sentryDsn: process.env.SENTRY_DSN?.trim() || undefined,
  environment: process.env.RENDER ? "production" : (process.env.NODE_ENV ?? "development"),
  release: process.env.RENDER_GIT_COMMIT,
});
const log = createLogger("collab");

type CollabContext = { claims: CollabClaims };
const COMMITTED = "foundry-committed-state";
const port = Number(process.env.PORT ?? process.env.COLLAB_PORT ?? "1234");
const revisions = new Map<string, number>();

const server = Server.configure({
  port,
  async onAuthenticate({ token, documentName, connection }) {
    if (!token || typeof token !== "string") throw new Error("Missing collaboration token");
    const env = getServerEnv();
    const claims = verifyCollabToken(token, env.AUTH_SECRET ?? env.DATABASE_URL);
    if (!claims) throw new Error("Invalid or expired collaboration token");
    const access = await authorizeCollaborationRoom(documentName, claims);
    connection.readOnly = !access.canEdit;
    return { claims } satisfies CollabContext;
  },
  async onLoadDocument({ document, documentName }) {
    if (parseSitePromptRoom(documentName)) return;
    const durable = await loadCollaborationDocument(documentName);
    Y.applyUpdate(document, durable.state, COMMITTED);
    revisions.set(documentName, durable.revision);
  },
  async beforeHandleMessage({ update, document, documentName, context, connection }) {
    const claims = (context as CollabContext).claims;
    const access = await authorizeCollaborationRoom(documentName, claims);
    connection.readOnly = !access.canEdit;
    const yUpdate = readDocumentUpdate(update, documentName);
    if (!yUpdate || Y.snapshotContainsUpdate(Y.snapshot(document), yUpdate)) return;
    await authorizeCollaborationRoom(documentName, claims, true);
    if (parseSitePromptRoom(documentName)) return;
    // Commit before Hocuspocus applies, acknowledges or broadcasts. A denied or
    // failed edit cannot leak into peers or overwrite SQL from a later store.
    const durable = await commitCollaborationUpdate(documentName, yUpdate, claims);
    Y.applyUpdate(document, durable.state, COMMITTED);
    revisions.set(documentName, durable.revision);
    document.broadcastStateless(JSON.stringify({ type: "committed", revision: durable.revision }));
    void publishCollaborationUpdate(documentName);
  },
  async afterUnloadDocument({ documentName }) {
    revisions.delete(documentName);
  },
  // No whole-document onStoreDocument write. Each accepted update is already durable.
});

async function reconcile(name: string): Promise<void> {
  const document = server.documents.get(name);
  if (!document || parseSitePromptRoom(name)) return;
  const state = await readCollaborationState(name);
  if (!state) {
    for (const connection of document.getConnections())
      connection.close({ code: 4404, reason: "This document was deleted" });
    return;
  }
  if (state.revision === revisions.get(name)) return;
  Y.applyUpdate(document, state.state, COMMITTED);
  revisions.set(name, state.revision);
  document.broadcastStateless(JSON.stringify({ type: "committed", revision: state.revision }));
}

await server.listen();
let unsubscribe: (() => void) | undefined;
try {
  unsubscribe = await subscribeCollaborationUpdates((name) => {
    void reconcile(name).catch((err) => log.warn("Live state reconciliation failed", { err }));
  });
} catch (err) {
  log.warn("Live notifications unavailable; durable reconciliation enabled", { err });
}
// Recover missed pub/sub notifications. Editing itself is real Yjs websocket
// traffic; this is only a catch-up for committed API/worker updates.
let reconciling = false;
const recovery = setInterval(async () => {
  if (reconciling) return;
  reconciling = true;
  try {
    for (const name of server.documents.keys()) {
      await reconcile(name).catch((err) => log.warn("Durable reconciliation failed", { err }));
    }
  } finally {
    reconciling = false;
  }
}, 5000);
recovery.unref();
process.once("SIGTERM", () => {
  clearInterval(recovery);
  unsubscribe?.();
  void server.destroy();
});
log.info("listening", {
  url: `ws://localhost:${port}`,
  errorReporting: observability.sentry ? "sentry" : "logs only",
});
