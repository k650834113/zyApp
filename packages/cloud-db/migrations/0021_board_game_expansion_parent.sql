ALTER TABLE cloud_board_game
  ADD COLUMN base_game_id UUID;

ALTER TABLE cloud_board_game
  ADD CONSTRAINT fk_cloud_board_game_base_game
  FOREIGN KEY (base_game_id)
  REFERENCES cloud_board_game(id)
  ON DELETE RESTRICT;

CREATE INDEX idx_cloud_board_game_base_game
  ON cloud_board_game (tenant_id, base_game_id);
