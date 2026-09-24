-- A setup link can make the platform admin: the person opening it chooses their own email and
-- password on the page, so no password ever passes through anyone else. One use, like every link.
alter table armada.invites add column admin boolean not null default false;
