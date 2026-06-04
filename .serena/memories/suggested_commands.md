# Suggested Commands

## Development
- `npm run dev` - Start daemon in dev mode with watch
- `npm run start` - Start daemon (production)
- `npm run build` - Build TypeScript to dist/
- `npm run typecheck` - Type-check without building

## Testing
- `NODE_OPTIONS="--experimental-vm-modules" npx jest --no-coverage` - Run all tests
- `NODE_OPTIONS="--experimental-vm-modules" npx jest tests/unit/ --no-coverage` - Unit tests only
- `NODE_OPTIONS="--experimental-vm-modules" npx jest tests/unit/services.test.js --no-coverage` - Single file
- `npm test` - Run all tests (includes integration, starts ephemeral daemon)
- `npm test -- --coverage` - Tests with coverage

## System Utilities (macOS/Darwin)
- `git`, `ls`, `cd`, `grep`, `find` - Standard Unix commands
- `lsof -i :PORT` - Check what's using a port
