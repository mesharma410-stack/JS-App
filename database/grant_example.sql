-- Replace example_username with existing user. Grant only necessary reports/routes.
INSERT INTO user_access_matrix(username,permission,access_level) VALUES
('example_username','Report','View'),
('example_username','Report: Inventory Serial Detail','View'),
('example_username','Route: Bought Out','View')
ON CONFLICT(username,permission) DO UPDATE SET access_level=excluded.access_level;
-- Disable access immediately: UPDATE app_users SET active=false WHERE username='example_username';
