-- The shop builder asks its owner to choose. The AI proposes twice as many products as the shop will
-- sell, and the build waits ('choosing') until the owner picks which ones go in (or lets the AI pick).
-- A shop that is choosing is waiting for a person, not stuck: the stalled-build sweep only looks at
-- 'building' shops, so it never touches one.
alter table armada.shops drop constraint shops_status_check;
alter table armada.shops add constraint shops_status_check
  check (status in ('draft', 'building', 'choosing', 'ready', 'publishing', 'published', 'failed'));
