alter table credit_cards add column if not exists sort_order integer not null default 0;

with ordered as (
  select
    id,
    row_number() over (
      partition by user_id
      order by name, created_at, id
    ) - 1 as rn
  from credit_cards
  where deleted_at is null
)
update credit_cards
set sort_order = ordered.rn
from ordered
where credit_cards.id = ordered.id;
