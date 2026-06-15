-- Machine Beam Plate demand per Machine Beam (component-demand rules; demand-only,
-- same item_demand_rules table as migration 030). Owner's "Machine Beam Plate"
-- mapping: each R1 / Belt machine beam needs 1x its Machine Beam Plate, by pass class
-- (SA-DC-021 Pass 4-8 / 022 Pass 10-13 / 024 Pass 13 Belt / 231 Pass 20 Belt; the
-- Pass 16 plate SA-DC-023 is unused). Parent = Machine Beam items (program-cut), so a
-- demand rule, NOT item_bom_lines (which would override the beam's own program).
insert into item_demand_rules (parent_item_id, child_item_id, qty, note)
select pf.id, cs.id, m.qty, 'machine beam plate'
from (values
('SA-DC-007','SA-DC-021',1),
('SA-DC-009','SA-DC-021',1),
('SA-DC-012','SA-DC-021',1),
('SA-DC-018','SA-DC-021',1),
('SA-DC-013','SA-DC-022',1),
('SA-DC-019','SA-DC-022',1),
('SA-DC-020','SA-DC-024',1),
('SA-DC-228','SA-DC-231',1)
) as m(beam_code, plate_code, qty)
join items pf on pf.code = m.beam_code
join items cs on cs.code = m.plate_code
on conflict (parent_item_id, child_item_id) do nothing;
