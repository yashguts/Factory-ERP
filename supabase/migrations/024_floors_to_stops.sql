-- 024: reinterpret jobs.floors as TOTAL STOPS.
-- Was "landings above ground" (the N in G+N). Drawings/study confirmed the BOM
-- carries floors+1 landing items, so total stops = floors + 1. The form dropdown
-- changes from "G+1, G+2…" to plain Stops (1,2,3…) — basements/roof make G+N wrong.
-- Both the form and the Excel importer stored N, so +1 is uniform. Applied
-- 2026-06-13 via apply_migration (recorded here for the trail).
update public.jobs set floors = floors + 1 where floors is not null;

-- Regenerate spec_string to "N Stops/Drive/Capacity" (drop old "G+N" + dead door slot).
update public.jobs
  set spec_string = nullif(
    concat_ws('/',
      case when floors is not null then floors::text || ' Stops' end,
      drive_type,
      capacity
    ), '');
