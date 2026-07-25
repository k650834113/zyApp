ALTER TABLE cloud_member
  ADD COLUMN profile_completed BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE cloud_member
SET profile_completed = TRUE
WHERE source <> 'miniapp' OR nickname <> '微信用户';
