import { createDecoder, readVarString, readVarUint, readVarUint8Array } from "lib0/decoding";

/** Hocuspocus v2 envelope: room, message kind, Yjs sync kind, payload. */
export function readDocumentUpdate(message: Uint8Array, expectedRoom: string): Uint8Array | null {
  if (message.length > 16_000_000) throw new Error("Collaboration message is too large");
  const decoder = createDecoder(message);
  if (readVarString(decoder) !== expectedRoom) throw new Error("Message does not match document");
  const type = readVarUint(decoder);
  if (type === 6) throw new Error("Client broadcast messages are not supported");
  if (type !== 0 && type !== 4) return null;
  const syncType = readVarUint(decoder);
  if (syncType === 0) return null;
  if (syncType !== 1 && syncType !== 2) throw new Error("Unknown collaboration sync message");
  return readVarUint8Array(decoder);
}
