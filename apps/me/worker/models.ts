export const MEMORY_STATUSES = ["pending", "active", "archived", "rejected"] as const;
export type MemoryStatus = typeof MEMORY_STATUSES[number];

export const MEMORY_KINDS = ["preference", "fact", "decision", "lesson", "note"] as const;
export type MemoryKind = typeof MEMORY_KINDS[number];

export const TIMELINE_STATUSES = ["pending", "active", "archived", "rejected"] as const;
export type TimelineStatus = typeof TIMELINE_STATUSES[number];

export const TIMELINE_KINDS = ["work", "startup", "education", "project", "life"] as const;
export type TimelineKind = typeof TIMELINE_KINDS[number];

export const PROPOSAL_STATUSES = ["pending", "approved", "rejected"] as const;
export type ProposalStatus = typeof PROPOSAL_STATUSES[number];

export const IMPORT_STATUSES = ["open", "finishing", "finished", "failed"] as const;
export type ImportStatus = typeof IMPORT_STATUSES[number];

export type MemoryView = {
  id: string;
  status: MemoryStatus;
  kind: MemoryKind;
  text: string;
  tags: string[];
  source_client: string;
  source_name: string | null;
  import_id: string | null;
  import_item_index: number | null;
  created_at: string;
  updated_at: string;
  reviewed_at: string | null;
};

export type TimelineView = {
  id: string;
  status: TimelineStatus;
  kind: TimelineKind;
  title: string;
  org: string | null;
  started_on: string | null;
  ended_on: string | null;
  body_excerpt: string;
  source_client: string;
  source_name: string | null;
  created_at: string;
  updated_at: string;
  reviewed_at: string | null;
};

export type TimelineDetail = Omit<TimelineView, "body_excerpt"> & { body: string | null };

export type ProfileView = {
  key: string;
  value: string;
  updated_at: string;
  updated_by: string;
};

export type ProfileProposalView = {
  id: string;
  key: string;
  value: string;
  status: ProposalStatus;
  source_client: string;
  source_name: string | null;
  created_at: string;
  updated_at: string;
  reviewed_at: string | null;
};

export type ImportView = {
  id: string;
  status: ImportStatus;
  source_client: string;
  source_name: string | null;
  next_index: number;
  chunk_count: number;
  item_count: number;
  bytes: number;
  approved_count: number;
  pending_count: number;
  memory_rejected_count: number;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
  error_code: string | null;
};

export type Page<T> = {
  items: T[];
  next_offset: number | null;
};

export type Overview = {
  pending_memories: number;
  active_memories: number;
  pending_timeline: number;
  pending_profile: number;
  open_imports: number;
  finished_imports: number;
};

export type MemoryFilters = {
  status?: MemoryStatus;
  query?: string;
  kind?: MemoryKind;
  tags?: string[];
  source?: string;
  reviewableOnly?: boolean;
};

export type TimelineFilters = {
  status?: TimelineStatus;
  query?: string;
  kind?: TimelineKind;
  from?: string;
  to?: string;
};
