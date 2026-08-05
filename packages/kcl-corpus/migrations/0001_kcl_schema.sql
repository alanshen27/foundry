-- FOUNDRY KCL training corpus.
--
-- Lives in its own `kcl` schema, deliberately NOT added to PostgREST's exposed
-- schemas: this is an offline training corpus, not an application API. RLS is
-- enabled with no permissive policies as a backstop, so only the service role
-- (which bypasses RLS) can reach it even if the schema is ever exposed.

create schema if not exists kcl;

-- ---------------------------------------------------------------- scrape_run
-- One row per extraction run. Drives incremental pulls and idempotency.
create table kcl.scrape_run (
  id              uuid primary key default gen_random_uuid(),
  started_at      timestamptz not null default now(),
  finished_at     timestamptz,
  source_kinds    text[]      not null default '{}',
  watermark_from  timestamptz,
  watermark_to    timestamptz,
  status          text        not null default 'running'
                  check (status in ('running', 'ok', 'failed')),
  error           text,
  stats           jsonb       not null default '{}'::jsonb
);

comment on table kcl.scrape_run is
  'Bookkeeping for one extraction pass. watermark_to becomes the next run''s watermark_from.';

-- ------------------------------------------------------------------ snippet
-- The deduped corpus: one row per unique KCL content, addressed by sha256.
create table kcl.snippet (
  id                  uuid primary key default gen_random_uuid(),
  sha256              text        not null unique,
  content             text        not null,
  char_len            int         not null,
  line_count          int         not null,
  component_kind      text        not null
                      check (component_kind in ('part', 'assembly', 'instructions')),
  origin              text        not null
                      check (origin in ('human', 'zoo_generated', 'template', 'external')),
  -- Scripts importing other modules cannot be engine-verified standalone;
  -- mirrors parseKclModuleImports / parseForeignImports in @foundry/cad.
  has_module_imports  boolean     not null default false,
  has_foreign_imports boolean     not null default false,
  -- Output of parseCadParams: top-level bindings that drive visual controls.
  top_level_params    jsonb       not null default '[]'::jsonb,
  license             text        not null default 'unknown',
  -- Exact-hash match against DEFAULT_KCL / DEFAULT_ASSEMBLY_KCL / proxies.
  -- Kept for provenance, excluded from every export view.
  is_boilerplate      boolean     not null default false,
  first_seen_at       timestamptz not null default now()
);

comment on column kcl.snippet.sha256 is
  'Dedupe key over raw content. Identical KCL from many projects collapses to one row.';

create index snippet_kind_idx    on kcl.snippet (component_kind, is_boilerplate);
create index snippet_origin_idx  on kcl.snippet (origin);
create index snippet_params_idx  on kcl.snippet using gin (top_level_params);

-- --------------------------------------------------------------- occurrence
-- Every place a snippet was observed. Preserves provenance after dedupe.
create table kcl.occurrence (
  id             uuid primary key default gen_random_uuid(),
  snippet_id     uuid not null references kcl.snippet (id) on delete cascade,
  source_kind    text not null
                 check (source_kind in
                   ('design_doc', 'chat_message', 'chat_run_event', 'repo', 'external')),
  source_id      text not null,
  -- HMAC-pseudonymized upstream; never raw FOUNDRY ids.
  project_ref    text,
  branch_ref     text,
  path           text,
  component_name text,
  observed_at    timestamptz not null default now(),
  scrape_run_id  uuid references kcl.scrape_run (id) on delete set null,

  -- NULLS NOT DISTINCT so a null path still collides on re-scrape (pg15+).
  constraint occurrence_natural_key
    unique nulls not distinct (source_kind, source_id, path, snippet_id)
);

create index occurrence_snippet_idx on kcl.occurrence (snippet_id);
create index occurrence_source_idx  on kcl.occurrence (source_kind, source_id);
create index occurrence_project_idx on kcl.occurrence (project_ref, branch_ref);

-- --------------------------------------------------------------- generation
-- Supervised NL -> KCL pairs recovered from copilot tool traffic.
create table kcl.generation (
  id                uuid primary key default gen_random_uuid(),
  prompt            text not null,
  tool_name         text not null
                    check (tool_name in
                      ('text_to_cad', 'iterate', 'save_cad_script',
                       'patch_cad_script', 'python_cad', 'add_part_to_assembly')),
  -- Set for iterate/edit flows: the "before" script.
  parent_snippet_id uuid references kcl.snippet (id) on delete set null,
  result_snippet_id uuid not null references kcl.snippet (id) on delete cascade,
  part_name         text,
  -- 0 = first try; >0 = a self-heal retry (see CAD_PART_MAX_ATTEMPTS).
  attempt_index     int  not null default 0,
  zoo_op_id         text,
  occurrence_id     uuid references kcl.occurrence (id) on delete set null,
  created_at        timestamptz not null default now()
);

create index generation_result_idx  on kcl.generation (result_snippet_id);
create index generation_parent_idx  on kcl.generation (parent_snippet_id);
create index generation_attempt_idx on kcl.generation (part_name, attempt_index);

-- ------------------------------------------------------------------ verdict
-- Engine correctness labels. The reason this corpus is worth building.
create table kcl.verdict (
  id                uuid primary key default gen_random_uuid(),
  snippet_id        uuid not null references kcl.snippet (id) on delete cascade,
  -- null = UNVERIFIED (imports need the full project, or no engine available).
  verified          boolean,
  unverified_reason text,
  execute_error     text,
  error_class       text check (error_class in
                      ('syntax', 'unknown_function', 'geometry', 'units', 'timeout', 'other')),
  checked_at        timestamptz not null default now(),
  source            text not null default 'tool_output'
                    check (source in ('tool_output', 'replay'))
);

create index verdict_snippet_idx on kcl.verdict (snippet_id);
create index verdict_state_idx   on kcl.verdict (verified, error_class);

-- --------------------------------------------------------------------- edit
-- patch_cad_script pairs. Rejected patches are signal too: the engine refused
-- them pre-save, so they are labelled negatives for an edit model.
create table kcl.edit (
  id                uuid primary key default gen_random_uuid(),
  before_snippet_id uuid not null references kcl.snippet (id) on delete cascade,
  after_snippet_id  uuid references kcl.snippet (id) on delete cascade,
  edits             jsonb   not null,
  accepted          boolean not null,
  reject_reason     text,
  occurrence_id     uuid references kcl.occurrence (id) on delete set null,
  created_at        timestamptz not null default now()
);

create index edit_before_idx on kcl.edit (before_snippet_id);

-- ------------------------------------------------------------------- render
-- Multimodal pairs: KCL <-> rendered view.
create table kcl.render (
  id          uuid primary key default gen_random_uuid(),
  snippet_id  uuid not null references kcl.snippet (id) on delete cascade,
  storage_key text not null,
  view        text not null
              check (view in ('iso', 'front', 'top', 'right', 'multiview')),
  mime        text,
  size_bytes  int,
  created_at  timestamptz not null default now(),

  constraint render_natural_key unique (snippet_id, storage_key, view)
);

create index render_snippet_idx on kcl.render (snippet_id);

-- ------------------------------------------------------------- export views

-- Clean supervised pairs: prompt -> KCL that the real engine accepted.
create view kcl.v_sft_pairs as
select
  g.id            as generation_id,
  g.prompt,
  g.tool_name,
  g.part_name,
  g.attempt_index,
  s.content       as kcl,
  s.component_kind,
  s.top_level_params,
  s.license,
  p.content       as parent_kcl
from kcl.generation g
join kcl.snippet s on s.id = g.result_snippet_id
left join kcl.snippet p on p.id = g.parent_snippet_id
where not s.is_boilerplate
  and exists (
    select 1 from kcl.verdict v
    where v.snippet_id = s.id and v.verified is true
  );

comment on view kcl.v_sft_pairs is
  'Prompt -> engine-verified KCL. Boilerplate templates excluded.';

-- Repair pairs: a failing attempt followed by a passing one for the same part.
create view kcl.v_repair_pairs as
select
  bad.id           as failed_generation_id,
  good.id          as fixed_generation_id,
  bad.prompt,
  bad.part_name,
  bs.content       as broken_kcl,
  bv.execute_error,
  bv.error_class,
  gs.content       as fixed_kcl
from kcl.generation bad
join kcl.snippet bs on bs.id = bad.result_snippet_id
join kcl.verdict bv on bv.snippet_id = bs.id and bv.verified is false
join kcl.generation good
  on good.part_name = bad.part_name
 and good.occurrence_id is not distinct from bad.occurrence_id
 and good.attempt_index > bad.attempt_index
join kcl.snippet gs on gs.id = good.result_snippet_id
join kcl.verdict gv on gv.snippet_id = gs.id and gv.verified is true;

comment on view kcl.v_repair_pairs is
  'Broken KCL + its engine error -> the attempt that fixed it. Self-heal chains.';

-- Accepted edit pairs for training a diff-style model.
create view kcl.v_edit_pairs as
select
  e.id,
  b.content as before_kcl,
  a.content as after_kcl,
  e.edits,
  e.accepted,
  e.reject_reason
from kcl.edit e
join kcl.snippet b on b.id = e.before_snippet_id
left join kcl.snippet a on a.id = e.after_snippet_id;

-- ---------------------------------------------------------------------- RLS
-- Backstop only. The `kcl` schema is not exposed via PostgREST; the scraper
-- connects with the service role, which bypasses RLS. Enabling it with no
-- permissive policy means an accidental exposure still denies anon/authenticated.
alter table kcl.scrape_run enable row level security;
alter table kcl.snippet    enable row level security;
alter table kcl.occurrence enable row level security;
alter table kcl.generation enable row level security;
alter table kcl.verdict    enable row level security;
alter table kcl.edit       enable row level security;
alter table kcl.render     enable row level security;

revoke all on all tables in schema kcl from anon, authenticated;
revoke all on schema kcl from anon, authenticated;
