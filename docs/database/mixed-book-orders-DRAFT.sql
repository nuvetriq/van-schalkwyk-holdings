-- DRAFT ONLY. Do NOT place in netlify/database/migrations or deploy yet.
-- One Yoco payment -> one master order -> zero, one or two brand sales.
-- Existing Netlify Blob PDFs / product catalogue are not touched.
-- Review with Netlify Database availability, cost and migration rollback first.
BEGIN;

CREATE TABLE vsh_mixed_orders (
  id uuid PRIMARY KEY,
  customer_name text NOT NULL CHECK (char_length(customer_name) BETWEEN 2 AND 120),
  customer_email text NOT NULL CHECK (char_length(customer_email) BETWEEN 3 AND 254),
  amount_cents bigint NOT NULL CHECK (amount_cents BETWEEN 100 AND 5000000),
  currency text NOT NULL DEFAULT 'ZAR' CHECK (currency = 'ZAR'),
  processing_mode text NOT NULL CHECK (processing_mode IN ('test','live')),
  status text NOT NULL DEFAULT 'checkout_pending' CHECK (
    status IN ('checkout_pending','awaiting_payment','paid','failed','refunded')
  ),
  checkout_id text UNIQUE,
  payment_id text UNIQUE,
  -- Immutable server-approved checkout snapshot, NEVER browser-provided prices.
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz,
  CHECK (status <> 'paid' OR (payment_id IS NOT NULL AND checkout_id IS NOT NULL))
);

CREATE TABLE vsh_mixed_order_lines (
  order_id uuid NOT NULL REFERENCES vsh_mixed_orders(id) ON DELETE RESTRICT,
  business text NOT NULL CHECK (business IN ('grannys','clever-cubs')),
  product_id uuid NOT NULL,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  price_cents bigint NOT NULL CHECK (price_cents BETWEEN 100 AND 5000000),
  private_pdf_path text NOT NULL,
  PRIMARY KEY (order_id,business,product_id),
  CHECK (private_pdf_path LIKE business || '/%')
);

CREATE TABLE vsh_mixed_brand_sales (
  order_id uuid NOT NULL REFERENCES vsh_mixed_orders(id) ON DELETE RESTRICT,
  business text NOT NULL CHECK (business IN ('grannys','clever-cubs')),
  subtotal_cents bigint NOT NULL CHECK (subtotal_cents BETWEEN 100 AND 5000000),
  currency text NOT NULL DEFAULT 'ZAR' CHECK (currency='ZAR'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (order_id,business)
);

CREATE TABLE vsh_mixed_payment_events (
  event_id text PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES vsh_mixed_orders(id) ON DELETE RESTRICT,
  checkout_id text NOT NULL,
  payment_id text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX vsh_mixed_payment_events_order_idx ON vsh_mixed_payment_events(order_id);

CREATE TABLE vsh_mixed_email_outbox (
  id text PRIMARY KEY,
  order_id uuid NOT NULL,
  business text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('customer-delivery','merchant-sale-notice')),
  sender text NOT NULL,
  recipient text NOT NULL,
  -- Brand-scoped metadata only. Private PDF paths NEVER appear in outgoing email.
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload)='object'),
  status text NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending','claimed','sent','retry','unknown','failed')
  ),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  provider_message_id text,
  claim_token uuid,
  claim_until timestamptz,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  UNIQUE(order_id,business,kind),
  FOREIGN KEY (order_id,business) REFERENCES vsh_mixed_brand_sales(order_id,business)
    ON DELETE RESTRICT
);
CREATE INDEX vsh_mixed_outbox_pending_idx
  ON vsh_mixed_email_outbox(next_attempt_at) WHERE status IN ('pending','retry');

CREATE TABLE vsh_mixed_download_grants (
  -- SHA-256 digest of a cryptographically random token. Never store plaintext.
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  order_id uuid NOT NULL,
  business text NOT NULL,
  product_id uuid NOT NULL,
  -- Stable random nonce; never a plaintext customer token. Kept so a server
  -- with its separate secret can reconstruct the SAME link after a crash.
  token_nonce uuid NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(order_id,business,product_id),
  FOREIGN KEY (order_id,business,product_id)
    REFERENCES vsh_mixed_order_lines(order_id,business,product_id) ON DELETE RESTRICT
);
CREATE INDEX vsh_mixed_grant_expiry_idx ON vsh_mixed_download_grants(expires_at);

COMMIT;
