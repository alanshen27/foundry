import { router } from "../trpc";
import { workspaceRouter } from "./workspace";
import { projectRouter } from "./project";
import { stageRouter } from "./stage";
import { artifactRouter } from "./artifact";
import { ideateRouter } from "./ideate";
import { engineerRouter } from "./engineer";
import { verifyRouter } from "./verify";
import { launchRouter } from "./launch";
import { designRouter } from "./design";
import { codeRouter } from "./code";

export const appRouter = router({
  workspace: workspaceRouter,
  project: projectRouter,
  stage: stageRouter,
  artifact: artifactRouter,
  ideate: ideateRouter,
  engineer: engineerRouter,
  verify: verifyRouter,
  launch: launchRouter,
  design: designRouter,
  code: codeRouter,
});

export type AppRouter = typeof appRouter;
