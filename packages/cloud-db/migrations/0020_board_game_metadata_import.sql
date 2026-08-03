ALTER TABLE cloud_board_game
  ADD COLUMN metadata_source TEXT,
  ADD COLUMN metadata_imported_at TIMESTAMPTZ;

ALTER TABLE cloud_board_game
  ADD CONSTRAINT ck_cloud_board_game_metadata_source
  CHECK (metadata_source IS NULL OR metadata_source = 'bgg');

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM cloud_board_game
    WHERE bgg_id IS NOT NULL
    GROUP BY tenant_id, bgg_id
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'duplicate tenant BGG ids must be resolved before migration 20';
  END IF;
END $$;

CREATE UNIQUE INDEX uq_cloud_board_game_tenant_bgg_id
  ON cloud_board_game (tenant_id, bgg_id)
  WHERE bgg_id IS NOT NULL;
