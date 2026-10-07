-- Additive guards preserve historical rows while making migrated write
-- behavior match the fresh-schema integer constraints.
CREATE TRIGGER IF NOT EXISTS fleet_call_auth_integer_insert BEFORE INSERT ON fleet_run_call_authorizations
WHEN typeof(NEW.lease_fence)<>'integer' OR NEW.lease_fence<0 OR typeof(NEW.call_sequence)<>'integer' OR NEW.call_sequence<=0 OR typeof(NEW.max_input_tokens)<>'integer' OR typeof(NEW.max_output_tokens)<>'integer' OR typeof(NEW.authorized_cost_microusd)<>'integer' OR (NEW.actual_cost_microusd IS NOT NULL AND typeof(NEW.actual_cost_microusd)<>'integer')
BEGIN SELECT RAISE(ABORT,'fleet call authorization requires integer accounting'); END;
CREATE TRIGGER IF NOT EXISTS fleet_call_auth_integer_update BEFORE UPDATE ON fleet_run_call_authorizations
WHEN typeof(NEW.lease_fence)<>'integer' OR NEW.lease_fence<0 OR typeof(NEW.call_sequence)<>'integer' OR NEW.call_sequence<=0 OR typeof(NEW.max_input_tokens)<>'integer' OR typeof(NEW.max_output_tokens)<>'integer' OR typeof(NEW.authorized_cost_microusd)<>'integer' OR (NEW.actual_cost_microusd IS NOT NULL AND typeof(NEW.actual_cost_microusd)<>'integer')
BEGIN SELECT RAISE(ABORT,'fleet call authorization requires integer accounting'); END;
CREATE TRIGGER IF NOT EXISTS fleet_spend_v2_integer_insert BEFORE INSERT ON fleet_run_spend_v2
WHEN typeof(NEW.input_tokens)<>'integer' OR typeof(NEW.output_tokens)<>'integer' OR typeof(NEW.provider_cost_microusd)<>'integer'
BEGIN SELECT RAISE(ABORT,'fleet spend requires integer accounting'); END;
CREATE TRIGGER IF NOT EXISTS fleet_spend_v2_integer_update BEFORE UPDATE ON fleet_run_spend_v2
WHEN typeof(NEW.input_tokens)<>'integer' OR typeof(NEW.output_tokens)<>'integer' OR typeof(NEW.provider_cost_microusd)<>'integer'
BEGIN SELECT RAISE(ABORT,'fleet spend requires integer accounting'); END;

-- ALTER TABLE cannot add CHECK constraints to the three lease columns without
-- rebuilding a live parent table. These guards preserve every existing row and
-- give all future INSERT/UPDATE writes the same lease constraints as schema.sql.
CREATE TRIGGER IF NOT EXISTS fleet_reservation_lease_integer_insert BEFORE INSERT ON fleet_run_reservations
WHEN typeof(NEW.lease_fence)<>'integer' OR NEW.lease_fence<0 OR (NEW.lease_expires_at IS NOT NULL AND typeof(NEW.lease_expires_at)<>'integer')
BEGIN SELECT RAISE(ABORT,'fleet reservation requires integer lease fencing'); END;
CREATE TRIGGER IF NOT EXISTS fleet_reservation_lease_integer_update BEFORE UPDATE ON fleet_run_reservations
WHEN typeof(NEW.lease_fence)<>'integer' OR NEW.lease_fence<0 OR (NEW.lease_expires_at IS NOT NULL AND typeof(NEW.lease_expires_at)<>'integer')
BEGIN SELECT RAISE(ABORT,'fleet reservation requires integer lease fencing'); END;
