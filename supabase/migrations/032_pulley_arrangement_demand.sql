-- Machine Beam Pulley Arrangement demand per safety frame (component-demand rules;
-- demand-only, same table as migration 030). Owner: pulley arrangement (SA-DC-025
-- Pass 4-8 / SA-DC-026 Pass 10-13) is driven by the R1 / BELT SAFETY FRAMES, 1 each.
-- (The machine-beam->pulley file was the alternative driver, intentionally NOT used,
-- to avoid double-counting since lifts carry both a frame and a machine beam.)
insert into item_demand_rules (parent_item_id, child_item_id, qty, note)
select pf.id, cs.id, m.qty, 'safety frame machine beam pulley'
from (values
('SF-HB-002','SA-DC-026',1),
('SA-DC-091','SA-DC-025',1),
('SA-DC-093','SA-DC-025',1),
('SA-DC-095','SA-DC-025',1),
('SA-DC-097','SA-DC-025',1),
('SA-DC-099','SA-DC-025',1),
('SA-DC-101','SA-DC-025',1),
('SA-DC-103','SA-DC-025',1),
('SA-DC-105','SA-DC-025',1),
('SA-DC-107','SA-DC-025',1),
('SA-DC-109','SA-DC-025',1),
('SA-DC-112','SA-DC-025',1),
('SA-DC-114','SA-DC-025',1),
('SA-DC-120','SA-DC-025',1),
('SA-DC-126','SA-DC-026',1),
('SA-DC-128','SA-DC-026',1),
('SA-DC-132','SA-DC-026',1),
('SA-DC-138','SA-DC-026',1),
('SA-DC-140','SA-DC-026',1),
('SA-DC-145','SA-DC-026',1),
('SA-DC-149','SA-DC-026',1),
('SA-DC-151','SA-DC-026',1),
('SA-DC-219','SA-DC-026',1),
('SA-DC-133','SA-DC-026',1),
('SA-DC-141','SA-DC-026',1),
('SA-DC-153','SA-DC-026',1),
('SA-DC-156','SA-DC-026',1),
('SA-DC-166','SA-DC-026',1)
) as m(frame_code, child_code, qty)
join items pf on pf.code = m.frame_code
join items cs on cs.code = m.child_code
on conflict (parent_item_id, child_item_id) do nothing;
