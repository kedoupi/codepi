-- Earlier consent callbacks cleared successful coverage without requeuing done
-- tasks. Re-fetch those windows; do not invent successful timestamps or alter
-- unfinished tasks, their attempt counts, retry deadlines or daily write budget.
WITH queues AS (
  SELECT s.*,coalesce((
    SELECT max(CAST(json_extract(t.value,'$.after') AS INTEGER)) FROM json_each(s.payload) t
    WHERE json_extract(t.value,'$.error') IN ('rate_limited','daily_sync_budget_reached','storage_write_quota_exceeded')
      AND json_extract(t.value,'$.state') IN ('pending','failed')
  ),0) AS cooldown FROM auto_sync_state s
), repair_items AS (
  SELECT s.user_id, CASE
    WHEN json_extract(t.value,'$.state')='done'
      AND json_extract(t.value,'$.collection')<>'__scores'
      AND NOT EXISTS (
        SELECT 1 FROM health_sync_windows w
        WHERE w.user_id=s.user_id
          AND w.collection=json_extract(t.value,'$.collection')
          AND w.window_from<=json_extract(t.value,'$.from')
          AND w.window_to>=json_extract(t.value,'$.to')
          AND w.synced_at IS NOT NULL AND w.last_error IS NULL
      )
    THEN json_remove(json_set(t.value,'$.state','pending','$.attempts',0,'$.after',s.cooldown),'$.error')
    ELSE t.value END AS item, 0 AS priority, CAST(t.key AS INTEGER) AS position
  FROM queues s, json_each(s.payload) t
  UNION ALL
  SELECT w.user_id, json_object(
    'collection',w.collection,
    'from',max(w.window_from,date(s.run_day,'-89 days')),
    'to',min(w.window_to,s.run_day),
    'state','pending','attempts',0,'after',s.cooldown
  ), 1, w.rowid
  FROM health_sync_windows w JOIN queues s ON s.user_id=w.user_id
  WHERE s.run_day IS NOT NULL AND w.synced_at IS NULL AND w.last_error IS NULL
    AND w.window_to>=date(s.run_day,'-89 days') AND w.window_from<=s.run_day
    AND NOT EXISTS (
      SELECT 1 FROM json_each(s.payload) t
      WHERE json_extract(t.value,'$.collection')=w.collection
        AND json_extract(t.value,'$.from')<=max(w.window_from,date(s.run_day,'-89 days'))
        AND json_extract(t.value,'$.to')>=min(w.window_to,s.run_day)
    )
), repaired AS MATERIALIZED (
  SELECT user_id, json_group_array(json(item)) AS payload
  FROM (SELECT * FROM repair_items ORDER BY user_id,priority,position) GROUP BY user_id
)
UPDATE auto_sync_state
SET payload=(SELECT r.payload FROM repaired r WHERE r.user_id=auto_sync_state.user_id),
    status=CASE WHEN status='blocked' THEN status ELSE 'running' END,
    finished_at=NULL,
    lease_id=lower(hex(randomblob(16))),lease_until=0
WHERE EXISTS (
  SELECT 1 FROM repaired r WHERE r.user_id=auto_sync_state.user_id AND r.payload<>json(auto_sync_state.payload)
);
