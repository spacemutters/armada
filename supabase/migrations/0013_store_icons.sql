-- Each store can have an icon (a name from the shop builder's icon set). The fleet map shows it;
-- a store without one is a plain square. Set by hand on the store's page, made by the AI, or taken
-- from the AI-built shop the store came from.
alter table armada.stores add column icon text;

update armada.stores s set icon = sh.blueprint -> 'brand' ->> 'monogramIcon'
from armada.shops sh where sh.store_id = s.id and s.icon is null and sh.blueprint -> 'brand' ->> 'monogramIcon' is not null;
