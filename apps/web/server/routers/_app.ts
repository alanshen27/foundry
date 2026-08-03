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
import { commentsRouter } from "./comments";
import { cadRouter } from "./cad";
import { collaborationRouter } from "./collaboration";
import { siteRouter } from "./site";
import { commerceRouter } from "./commerce";
import { mediaRouter } from "./media";
import { userRouter } from "./user";

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
  comments: commentsRouter,
  cad: cadRouter,
  collaboration: collaborationRouter,
  site: siteRouter,
  commerce: commerceRouter,
  media: mediaRouter,
  user: userRouter,
});

export type AppRouter = typeof appRouter;
