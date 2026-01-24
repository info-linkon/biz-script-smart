-- Add columns for full call tracking and history
ALTER TABLE calls ADD COLUMN IF NOT EXISTS call_summary text;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS customer_name text;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS customer_topic text;

-- Add index for faster queries on in-progress calls
CREATE INDEX IF NOT EXISTS idx_calls_status_user ON calls(user_id, status);

-- Comment on columns for documentation
COMMENT ON COLUMN calls.transcript IS 'Full conversation transcript in JSON format';
COMMENT ON COLUMN calls.call_summary IS 'AI-generated summary of the call';
COMMENT ON COLUMN calls.customer_name IS 'Customer name extracted from conversation';
COMMENT ON COLUMN calls.customer_topic IS 'Main topic/reason for the call';