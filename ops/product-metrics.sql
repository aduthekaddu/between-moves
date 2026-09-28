-- [BM-052] Pilot metrics over the trailing 28 days. Aggregate rows only: no House or Member IDs.
-- Run: psql -X -v ON_ERROR_STOP=1 -d "$DATABASE_URL" -f ops/product-metrics.sql
with active_houses as (
  select id from houses where status = 'active'
), active_members as (
  select member.id, member.house_id from memberships member
  join active_houses house on house.id = member.house_id
  where member.status = 'active'
), moved_houses as (
  select distinct house_id from moves
  where server_received_at >= now() - interval '28 days'
), recent_members as (
  select actor_membership_id as id from moves
    where server_received_at >= now() - interval '28 days'
  union
  select membership_id from night_attendance
    where first_joined_at >= now() - interval '28 days'
  union
  select membership_id from house_messages
    where created_at >= now() - interval '28 days' and deleted_at is null
), ended_nights as (
  select id, house_id from house_nights
  where state = 'ended' and ended_at >= now() - interval '28 days'
), night_attendees as (
  select distinct a.membership_id from night_attendance a
  join ended_nights n on n.id = a.night_id
), correspondence_intervals as (
  select hours from (
    select m.server_received_at,
      extract(epoch from (m.server_received_at -
        lag(m.server_received_at, 1, g.created_at) over
          (partition by m.game_id order by m.ply))) / 3600 as hours
    from moves m join games g on g.id = m.game_id
    where g.mode = 'correspondence'
  ) intervals
  where server_received_at >= now() - interval '28 days'
)
select 'houses_with_a_move_28d' as metric,
  count(distinct moved_houses.house_id)::numeric as value,
  count(distinct active_houses.id)::numeric as sample_size
from active_houses left join moved_houses on moved_houses.house_id = active_houses.id
union all
select 'active_member_rate_28d',
  coalesce(round(count(distinct recent_members.id)::numeric /
    nullif(count(distinct active_members.id), 0), 4), 0),
  count(distinct active_members.id)::numeric
from active_members left join recent_members on recent_members.id = active_members.id
union all
select 'night_attendance_rate_28d',
  coalesce(round(count(distinct night_attendees.membership_id)::numeric /
    nullif(count(distinct active_members.id), 0), 4), 0),
  count(distinct active_members.id)::numeric
from active_members left join night_attendees on night_attendees.membership_id = active_members.id
union all
select 'correspondence_move_median_hours_28d',
  coalesce(round(percentile_cont(0.5) within group (order by hours)::numeric, 2), 0),
  count(*)::numeric
from correspondence_intervals
union all
select 'published_puzzles_28d', count(*)::numeric, count(*)::numeric
from house_puzzles where published_at >= now() - interval '28 days'
order by metric;
