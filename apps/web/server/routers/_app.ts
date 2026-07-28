import { router } from "../trpc";
import { workspaceRouter } from "./workspace";
import { projectRouter } from "./project";
import { folderRouter } from "./folder";
import { stageRouter } from "./stage";
import { artifactRouter } from "./artifact";
import { ideateRouter } from "./ideate";
import { engineerRouter } from "./engineer";
import { verifyRouter } from "./verify";
import { launchRouter } from "./launch";
import { designRouter } from "./design";
import { codeRouter } from "./code";
import { chatRouter } from "./chat";
import { cadRouter } from "./cad";
import { collaborationRouter } from "./collaboration";
import { siteRouter } from "./site";
import { commerceRouter } from "./commerce";

export const appRouter = router({
  workspace: workspaceRouter,
  project: projectRouter,
  folder: folderRouter,
  stage: stageRouter,
  artifact: artifactRouter,
  ideate: ideateRouter,
  engineer: engineerRouter,
  verify: verifyRouter,
  launch: launchRouter,
  design: designRouter,
  code: codeRouter,
  chat: chatRouter,
  cad: cadRouter,
  collaboration: collaborationRouter,
  site: siteRouter,
  commerce: commerceRouter,
});

export type AppRouter = typeof appRouter;
