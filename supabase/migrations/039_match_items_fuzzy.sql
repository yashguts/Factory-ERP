-- Fuzzy item matching for the Part List reader. Trigram similarity (pg_trgm) so an
-- extracted line like "Filler Weight 850/150 MS" finds "Filler Weight A.H.M
-- DBG-850/150mm(M.S)" even though the wording differs. Batched: one call returns
-- the top candidates for EVERY part-list line (q_index is the 1-based input index).
-- Scores blend full-string similarity, word_similarity (query-as-substring), and
-- code/lookup_key similarity; the AI then picks the exact variant from these.
-- pg_trgm is already installed (public schema).
create or replace function match_items_fuzzy_batch(queries text[], lim int default 12)
returns table(q_index int, id uuid, code text, name text, category_name text, uom text, score real)
language sql
stable
as $$
  select t.q_index::int, m.id, m.code, m.name, m.category_name, m.uom, m.score
  from unnest(queries) with ordinality as t(q, q_index)
  cross join lateral (
    select i.id, i.code, i.name, c.name as category_name, u.abbreviation as uom,
      greatest(
        similarity(lower(i.name), lower(t.q)),
        word_similarity(lower(t.q), lower(i.name)),
        similarity(lower(coalesce(i.lookup_key, '')), lower(t.q)),
        similarity(lower(i.code), lower(t.q))
      ) as score
    from items i
    left join item_categories c on c.id = i.category_id
    left join units_of_measurement u on u.id = i.uom_id
    where i.is_active
      and length(trim(t.q)) > 1
    order by score desc
    limit lim
  ) m
  where m.score > 0.15;
$$;
