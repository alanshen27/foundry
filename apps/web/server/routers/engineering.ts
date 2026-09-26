import {
  assemblyInstanceSchema,
  engineeringMutationSchema,
  engineeringScopeSchema,
} from "@/lib/engineering/input";
import { getEngineeringStatus, updateEngineering } from "../engineering";
import { protectedProcedure, router } from "../trpc";

export const engineeringRouter = router({
  status: protectedProcedure
    .input(engineeringScopeSchema)
    .query(({ ctx, input }) => getEngineeringStatus({ ...input, userId: ctx.user.id })),
  syncPcbToCad: protectedProcedure
    .input(engineeringMutationSchema)
    .mutation(({ ctx, input }) =>
      updateEngineering(
        { ...input, userId: ctx.user.id },
        { action: "sync_pcb_to_cad", expectedFingerprint: input.expectedFingerprint },
      ),
    ),
  buildAssembly: protectedProcedure
    .input(
      engineeringMutationSchema.extend({
        instances: assemblyInstanceSchema.array().max(200).optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      updateEngineering(
        { ...input, userId: ctx.user.id },
        {
          action: "build_linked_assembly",
          expectedFingerprint: input.expectedFingerprint,
          instances: input.instances,
        },
      ),
    ),
});
