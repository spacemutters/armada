-- Email and password sign-in, next to passkeys, and platform admins.
--
-- A member may have an email and a password as well as passkeys. The email is stored lower-cased
-- and is unique across every workspace, because signing in by email has to find exactly one member.
-- The password is kept only as a scrypt hash made by lib/auth/password.ts ("scrypt$N$r$p$salt$hash").
-- is_admin marks a platform admin: someone who can see every workspace on /admin. It is set only by
-- scripts/make-admin.mjs, never by the app.

alter table armada.members
  add column email text,
  add column password_hash text,
  add column password_changed_at timestamptz,
  add column is_admin boolean not null default false;

alter table armada.members
  add constraint members_email_unique unique (email),
  add constraint members_email_lower check (email is null or email = lower(btrim(email))),
  add constraint members_password_format check (password_hash is null or password_hash like 'scrypt$%');

-- Every email-and-password sign-in try, right or wrong, so too many wrong tries can be refused.
-- outcome: 'ok' (signed in), 'wrong' (password checked and rejected; also written before the check
-- and only turned into 'ok' after it, so a try that dies halfway still counts) or 'locked' (refused
-- without checking the password). Only system code reads or writes it.
create table armada.login_attempts (
  id bigint generated always as identity primary key,
  email text not null,
  ip text not null,
  outcome text not null default 'wrong' check (outcome in ('ok', 'wrong', 'locked')),
  ok boolean generated always as (outcome = 'ok') stored,
  at timestamptz not null default now()
);
create index login_attempts_email on armada.login_attempts (email, at desc);
create index login_attempts_ip on armada.login_attempts (ip, at desc);
create index login_attempts_at on armada.login_attempts (at);

alter table armada.login_attempts enable row level security;
create policy system_only on armada.login_attempts using (armada.is_system()) with check (armada.is_system());

grant select, insert, update, delete on armada.login_attempts to armada_app;
grant usage, select on sequence armada.login_attempts_id_seq to armada_app;
