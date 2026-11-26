-- Trigger functions run with the connection search path, which may differ from
-- the schema containing the trigger. Resolve List through the trigger table's
-- schema so membership inserts work in hosted schemas such as "todo".
CREATE OR REPLACE FUNCTION "enforce_custom_list_membership"() RETURNS TRIGGER AS $$
DECLARE
  custom_list_exists BOOLEAN;
BEGIN
  EXECUTE format(
    'SELECT EXISTS (SELECT 1 FROM %I."List" WHERE "id" = $1 AND "kind" = ''CUSTOM'')',
    TG_TABLE_SCHEMA
  )
  INTO custom_list_exists
  USING NEW."listId";

  IF NOT custom_list_exists THEN
    RAISE EXCEPTION 'Only custom Todo lists can have members';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
