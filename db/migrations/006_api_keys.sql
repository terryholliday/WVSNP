-- ============================================
-- API KEYS TABLE (Phase 5)
-- ============================================

CREATE TABLE IF NOT EXISTS api_keys (
  key_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key_hash VARCHAR(64) NOT NULL,  -- SHA-256 of full key
  key_prefix VARCHAR(20) NOT NULL,  -- First 12 chars for display
  entity_type VARCHAR(10) NOT NULL CHECK (entity_type IN ('CLINIC', 'GRANTEE')),
  entity_id UUID NOT NULL,
  scopes JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  created_by_actor_id UUID,
  revoked_by_actor_id UUID,
  revocation_reason TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_entity ON api_keys(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_active ON api_keys(entity_type, entity_id) 
  WHERE revoked_at IS NULL AND (expires_at IS NULL OR expires_at > NOW());

-- Helper function to generate API key
CREATE OR REPLACE FUNCTION generate_api_key(
  p_entity_type VARCHAR,
  p_entity_id UUID,
  p_scopes JSONB,
  p_expires_at TIMESTAMPTZ DEFAULT NULL,
  p_created_by UUID DEFAULT NULL
) RETURNS TABLE (
  key_id UUID,
  api_key TEXT,
  key_prefix VARCHAR
) AS $$
DECLARE
  v_key_id UUID;
  v_random_bytes BYTEA;
  v_api_key TEXT;
  v_key_hash VARCHAR(64);
  v_key_prefix VARCHAR(20);
BEGIN
  -- Generate random key
  v_key_id := gen_random_uuid();
  v_random_bytes := gen_random_bytes(32);
  v_api_key := 'wvsnp_' || lower(p_entity_type) || '_' || encode(v_random_bytes, 'hex');
  v_key_hash := encode(digest(v_api_key, 'sha256'), 'hex');
  v_key_prefix := substring(v_api_key, 1, 20);
  
  -- Insert key record
  INSERT INTO api_keys (
    key_id, key_hash, key_prefix, entity_type, entity_id, scopes,
    expires_at, created_by_actor_id
  ) VALUES (
    v_key_id, v_key_hash, v_key_prefix, p_entity_type, p_entity_id, p_scopes,
    p_expires_at, p_created_by
  );
  
  -- Return key details (ONLY TIME THE FULL KEY IS VISIBLE)
  RETURN QUERY SELECT v_key_id, v_api_key, v_key_prefix;
END;
$$ LANGUAGE plpgsql;

-- Helper function to validate API key
CREATE OR REPLACE FUNCTION validate_api_key(
  p_api_key TEXT
) RETURNS TABLE (
  key_id UUID,
  entity_type VARCHAR,
  entity_id UUID,
  scopes JSONB,
  is_valid BOOLEAN,
  error_reason TEXT
) AS $$
DECLARE
  v_key_hash VARCHAR(64);
  v_key_record RECORD;
BEGIN
  v_key_hash := encode(digest(p_api_key, 'sha256'), 'hex');
  
  SELECT * INTO v_key_record
  FROM api_keys
  WHERE key_hash = v_key_hash;
  
  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::UUID, NULL::VARCHAR, NULL::UUID, NULL::JSONB, FALSE, 'KEY_NOT_FOUND';
    RETURN;
  END IF;
  
  IF v_key_record.revoked_at IS NOT NULL THEN
    RETURN QUERY SELECT v_key_record.key_id, v_key_record.entity_type, v_key_record.entity_id, 
                        v_key_record.scopes, FALSE, 'KEY_REVOKED';
    RETURN;
  END IF;
  
  IF v_key_record.expires_at IS NOT NULL AND v_key_record.expires_at < NOW() THEN
    RETURN QUERY SELECT v_key_record.key_id, v_key_record.entity_type, v_key_record.entity_id,
                        v_key_record.scopes, FALSE, 'KEY_EXPIRED';
    RETURN;
  END IF;
  
  -- Update last_used_at
  UPDATE api_keys SET last_used_at = NOW() WHERE key_hash = v_key_hash;
  
  RETURN QUERY SELECT v_key_record.key_id, v_key_record.entity_type, v_key_record.entity_id,
                      v_key_record.scopes, TRUE, NULL::TEXT;
END;
$$ LANGUAGE plpgsql;
