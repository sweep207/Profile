-- Run once on an existing D1 database before deploying the Uplocket-enabled Worker.
ALTER TABLE orders ADD COLUMN provider_activation_id TEXT;
ALTER TABLE orders ADD COLUMN activation_code TEXT;
ALTER TABLE orders ADD COLUMN install_url TEXT;
ALTER TABLE orders ADD COLUMN provider_error TEXT;
