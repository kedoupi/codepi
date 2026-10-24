-- Coverage lookups filter a collection by both window bounds. The primary key
-- can only use its user/collection prefix for those two range predicates, so
-- historical windows otherwise become a growing scan.
CREATE INDEX IF NOT EXISTS health_sync_windows_user_collection_bounds
  ON health_sync_windows(user_id, collection, window_from, window_to);
