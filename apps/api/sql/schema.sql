create table if not exists runs (
  id text primary key,
  goal text not null,
  base_ref text not null,
  base_sha text not null,
  patch_pointer text not null,
  eval_pointers jsonb not null default '[]'::jsonb,
  transcript_pointer text,
  reproducibility text not null,
  status text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists evals (
  id text primary key,
  run_id text not null,
  commands jsonb not null,
  passed boolean not null,
  summary text not null,
  artifact_pointer text not null,
  created_at timestamptz not null
);

create table if not exists bundles (
  id text primary key,
  run_id text not null,
  pr_url text,
  summary text not null,
  published_at timestamptz not null
);
