-- Explicit owner repair consent is bound to the initiating OAuth transaction.
-- Nullable addition keeps existing transactions and older Workers compatible.
ALTER TABLE oauth_states ADD COLUMN repair_from_provider_id TEXT;
