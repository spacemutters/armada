-- A shop's Pinterest, connected through the connection service (its approved Pinterest app). Its
-- `secret` holds only which account it is at the service, never a key; `meta` holds the board the
-- shop's pins go to.
alter table armada.social_accounts drop constraint if exists social_accounts_platform_check;
alter table armada.social_accounts add constraint social_accounts_platform_check
  check (platform in ('instagram', 'facebook', 'tiktok', 'pinterest'));
