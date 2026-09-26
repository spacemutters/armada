-- The email shoppers of a workspace's real shops write to (contact page, refund and shipping
-- policies). Unset, real shops use the owner's sign-in email; practice shops keep their reserved
-- .example address, so nothing sent there reaches anyone.
alter table armada.workspaces add column if not exists support_email text;
alter table armada.workspaces drop constraint if exists workspaces_support_email_shape;
alter table armada.workspaces add constraint workspaces_support_email_shape
  check (support_email is null or (support_email = lower(btrim(support_email)) and support_email ~ '^[^@\s]+@[^@\s]+\.[a-z]{2,}$'));
