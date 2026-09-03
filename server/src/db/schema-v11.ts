export const SCHEMA_V11 = `
-- BUG-003: a validator that terminates without producing a verdict (interrupted
-- by a restart, cancelled, or failed to spawn) used to wedge its Issue forever.
-- Two invariants collided: idx_runs_validator_per_round reserved
-- (issue, validation_round) for one validator regardless of terminal status,
-- while validation_round_count only counts *formed* failed verdicts and so never
-- advanced past a run that produced none. Every retry after the operator
-- unblocked asked for the same round and hit the same dead run.
--
-- The round is the unit of the Issue's validation budget (max_validation_rounds);
-- the attempt is how many times we tried to obtain that round's verdict. They are
-- different things, and only the round should cost the user anything. Adding the
-- attempt dimension keeps every run's validation_round immutable (PRD §7.5) while
-- letting a spent attempt be superseded rather than blocking the round forever.

ALTER TABLE runs ADD COLUMN validation_attempt INTEGER;

-- Every historical validator run is attempt 1 of its round: before this
-- migration the index made a second attempt impossible, so no other value can
-- exist. Rows whose validation_round is NULL are left alone — they are not part
-- of the partial index and carry no round to attempt.
UPDATE runs
  SET validation_attempt = 1
  WHERE role = 'validator' AND validation_round IS NOT NULL AND validation_attempt IS NULL;

DROP INDEX IF EXISTS idx_runs_validator_per_round;

-- Per-(round, attempt) uniqueness. One validator may still own a given attempt of
-- a given round; a new attempt is a new row, so the dead one keeps its identity
-- and its round for the audit trail. idx_runs_one_active_validator (schema-v4)
-- continues to guarantee at most one live validator per Issue, so attempts can
-- never run concurrently.
CREATE UNIQUE INDEX IF NOT EXISTS idx_runs_validator_per_round_attempt
  ON runs(issue_id, validation_round, validation_attempt)
  WHERE role = 'validator' AND validation_round IS NOT NULL;
`;
