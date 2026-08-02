ALTER TABLE cloud_board_game
  ADD COLUMN complexity_rating NUMERIC(2,1);

ALTER TABLE cloud_board_game
  ADD CONSTRAINT ck_cloud_board_game_complexity_rating
  CHECK (
    complexity_rating IS NULL OR
    (complexity_rating >= 0.0 AND complexity_rating <= 5.0)
  );

CREATE TABLE miniapp_board_game_like (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant(id),
  store_id UUID NOT NULL REFERENCES store(id),
  board_game_id UUID NOT NULL REFERENCES cloud_board_game(id),
  viewer_id UUID NOT NULL REFERENCES miniapp_identity(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, store_id, board_game_id, viewer_id)
);

CREATE INDEX idx_miniapp_board_game_like_game
  ON miniapp_board_game_like(tenant_id, store_id, board_game_id);

CREATE INDEX idx_miniapp_board_game_like_viewer
  ON miniapp_board_game_like(
    tenant_id, store_id, viewer_id, created_at DESC
  );
