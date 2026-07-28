/**
 * SiteBuilderPort: the only site-generation surface app code may use.
 *
 * Implementation: the v0 Platform API, which owns generation, preview
 * hosting, and deployment. FOUNDRY stores only the identifiers needed to
 * resume a conversation — it never runs build containers or dev servers of
 * its own (PRD 19, "Site/Commerce Service").
 */

/** One generated revision of a site. */
export type SiteRevision = {
  /** Builder conversation id. Every revision of one site shares it. */
  chatId: string;
  /** Builder version id for this revision; the deploy target. */
  versionId: string | null;
  /** Sandboxed preview URL for this revision. Null while still generating. */
  previewUrl: string | null;
  /** The builder's own editor URL, for an "open in v0" escape hatch. */
  builderUrl: string | null;
  /**
   * True when this revision came from the SIMULATED adapter rather than a
   * real builder. Simulated revisions MUST be labeled in the UI and MUST
   * NOT be published (AGENTS.md rule 3).
   */
  simulated: boolean;
};

export type SiteDeployment = {
  id: string;
  /** Public URL of the deployed site. */
  url: string;
  /** Provider-side inspector/logs URL, when the builder returns one. */
  inspectorUrl: string | null;
};

export type SiteResult<T> = { ok: true; data: T } | { ok: false; error: string };

export type SiteGenOptions = {
  /**
   * Product context injected as the builder's system prompt. This is where
   * FOUNDRY's advantage over a bare prompt lives: real specs, components,
   * and release facts from the product graph.
   */
  system?: string;
  /** Cancel an in-flight builder request (chat stop / run cancel). */
  signal?: AbortSignal;
};

export interface SiteBuilderPort {
  /** Generate a new site from a natural-language prompt. */
  createSite(prompt: string, opts?: SiteGenOptions): Promise<SiteResult<SiteRevision>>;
  /** Iterate on an existing site with a follow-up prompt. */
  reviseSite(
    chatId: string,
    prompt: string,
    opts?: SiteGenOptions,
  ): Promise<SiteResult<SiteRevision>>;
  /** Publish a specific revision to public hosting. */
  publishSite(
    chatId: string,
    versionId: string,
    opts?: SiteGenOptions,
  ): Promise<SiteResult<SiteDeployment>>;
}
