import { z } from "zod";

const vector = (limit: number) =>
  z.object({
    x: z.number().finite().min(-limit).max(limit),
    y: z.number().finite().min(-limit).max(limit),
    z: z.number().finite().min(-limit).max(limit),
  });

export const assemblyInstanceSchema = z.object({
  id: z.string().min(1).max(120),
  componentId: z.string().min(1).max(160),
  translationMm: vector(1_000_000),
  rotationDeg: vector(360_000),
  visible: z.boolean(),
  fixed: z.boolean(),
});

export const engineeringScopeSchema = z.object({
  projectId: z.string().min(1),
  branchId: z.string().min(1),
});
export const engineeringMutationSchema = engineeringScopeSchema.extend({
  expectedFingerprint: z.string().length(64),
});
