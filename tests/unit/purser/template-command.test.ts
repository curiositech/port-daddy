We need to write tests for pd sitrep --template. Target file tests/unit/purser/template-command.test.ts. Must test homedir derivation, roadmap claim pre-filling, error handling. Need to import relevant modules.

Let's inspect repository structure for cli/commands/sitrep.ts. Also tests for sitrep-template.test.js exist; but new file is purser/template-command.test.ts. Let's open test file content? not provided. We need to mimic similar tests but for purser. Let's search for pd sitrep command implementation.
We don't have repo files, but we can approximate. Let's open cli/commands/sitrep.ts path.
We can't open actual file here, but we can deduce from tests. In tests/unit/sitrep-template.test.js they test pd sitrep --template. That file exists. We need to create new test for purser template command? Wait file path: tests/unit/purser/template-command.test.ts. Purser likely refers to a submodule for command parsing? Let's search for "purser" in repo.
We can't search but likely there's a module that parses command-line arguments into "purser" (maybe a CLI command parser). Maybe the new test will use the command implementation to test that --template works. Let's inspect tests/unit/sitrep-template.test.js to replicate.
We don't have content. But we can approximate: tests for pd sitrep --template likely spawn the command via child_process exec or import the command module. The test should verify that the transcript pointer uses os.homedir() and not hardcoded path. Also verify that the table pre-fills from active roadmap claims: need to mock fetch to cartographer. The code probably uses fetch to get claims. In tests they need to stub fetch. In Node environment, fetch global is available. In tests we can override global.fetch with a mocked implementation.

Also test error handling: non-ok cartographer response and thrown fetch both fail-silent to blank scaffold.

Also test that placeholder row is not included.

Also test that when homedir path is derived, it contains os.homedir().

Also test that when no session (no session id) placeholder is not used? Wait: the test description says "no-session placeholder". So maybe the command includes placeholder row for session? It might include placeholder row for "no session" if no session id? The test might check that no placeholder row is included.

Let's design tests:

- Use jest to set env variable PD_SITREP? Not relevant.

- We'll import the command module: maybe cli/commands/sitrep.ts exports a function runSitrepTemplate. Let's assume default export. Or maybe it's a class. Let's inspect repository? Can't. We'll guess.

Better approach: Use child_process exec to run "node bin/pd" with arguments "sitrep --template". But repository may not expose pd script. The bin/pd is a shell script maybe. Let's check bin/pd-hook-prompt etc. But for command tests they might import command directly.

Given we don't have code, we need to approximate but ensure imports resolve. We need to look at path of command file: cli/commands/sitrep.ts. Let's open it?
We don't have ability to open file, but we can guess exports. Usually cli commands are in cli/commands with .ts files exporting a function. For example, tests for other commands might import them. Let's search for tests for other command modules.
Search tests/unit/... maybe there are tests for other commands.
We can't search but maybe tests/unit/sitrep-cli.test.js exists. Let's open tests/unit/sitrep-cli.test.js.
We don't have file. But we can approximate: tests/unit/sitrep-cli.test.js probably tests command parsing for sitrep. But we need tests for template command.

Given limited info, we can write tests that import the command module and call its exported function, mocking fetch and os.homedir.

Let's inspect code of sitrep.ts maybe.
We cannot open. But we can guess that it uses fetch to GET /cartographer/roadmap-claims? Might use a base URL.

But tests should not depend on actual network. So we will mock fetch.

Also homedir derivation: The command likely uses os.homedir() to construct transcript pointer: "file://{homedir}/.portdaddy/roadmap-transcript.md" or something. We'll test that the output string contains os.homedir() and not static path.

Also table pre-fill: The command likely outputs a markdown table with header and rows for each claim. We'll test that the output contains claim rows for each mock claim, and not contains placeholder row like "| | | | | |".

Also error handling: When fetch returns non-ok or throws, the command should output blank scaffold: just header and no rows. We'll test that.

Also "no-session placeholder": maybe if no session ID (like process.env.PD_SESSION) is set, a placeholder row is inserted. We need to test that placeholder row is not present when session env variable is present? Not sure.

Simplify: test that when session id missing, placeholder row is present. Let's assume that.

Let's design tests:

1. test('homedir derivation'):
   - mock os.homedir() to return '/mock/home'
   - mock fetch to return empty claims.
   - capture stdout from command execution by calling exported function with args ['--template'].
   - assert output contains 'file:///mock/home/.portdaddy/roadmap-transcript.md' or similar. We need actual pointer string: maybe "file://{homedir}/.portdaddy/roadmap-transcript.md". We'll search for "transcript pointer" in code. But we can't. We'll guess.

   Use regex: /file:\/\/\/mock\/home\/.*transcript\.md/

2. test('pre-fills from roadmap claims'):

   - mock fetch to return ok JSON with claims array: [{id:'claim1', status:'open', ...}]. The command should output rows like '| claim1 | ... |'. We'll assert output contains that.

3. test('fails silently with non-ok cartographer response'):

   - mock fetch to return {ok:false}.

   - capture output; should contain only header and no claim rows.

4. test('fails silently with thrown fetch'):

   - mock fetch to throw error.

   - same expectation.

5. test('no-session placeholder'):

   - set env PD_SESSION undefined.

   - mock fetch to return empty claims.

   - output should include a placeholder row something like '| no session | | | | |'.

   - if PD_SESSION defined, placeholder row not present. We need to test that placeholder row appears only when session missing.

But we need to know placeholder row format. Might be something like '| | | | | |' or ' | | | | | |'. We'll guess.

We can inspect test for sitrep-template.test.js maybe they already test placeholder. But we cannot. But we can approximate.

Ok, implement tests accordingly.

Need to import os, path, etc.

We need to capture stdout of command. If command exports a function that writes to console.log, we can capture console.log by mocking console.log. Or if it returns string.

Let's inspect typical command modules: e.g., cli/commands/roadmap.ts maybe. But we can't.

Simplify: We'll import the module and call its default export function with args array and env override. Suppose exported as function run(args, env). We'll try to import as default. We'll use dynamic import.

But we don't know signature. Let's open tests for other commands to see pattern. Search for 'cli/commands' imports.
We can't search. But we can approximate by reading other test files: tests/unit/purser/template-command.test.ts is new; tests/unit/sitrep-template.test.js exists; maybe it uses exec. Let's open that file.
We don't have content. But we can approximate.

Given uncertainty, maybe easiest is to test the command by executing the CLI binary via child_process.execFileSync. The project likely has a bin/pd script that dispatches to commands. The command 'sitrep --template' would run the script.

Let's inspect bin/pd? But not available. But we can approximate path: 'bin/pd' is a script that uses Node to run. The tests may use spawnSync.

In tests/unit/sitrep-template.test.js maybe they use execa. Let's guess.

Simplify: Use child_process.execSync('node bin/pd sitrep --template') and capture stdout. We'll need to set env variables.

But we need to mock fetch globally. We can monkeypatch global.fetch before exec. But exec runs a new process, so mocking in parent won't affect child. So need to stub fetch in the child process. We could set environment variable to indicate to command to use a mock fetch? That seems complex.

Better: Import the command module directly.

Let's open sitrep.ts to see exports. Let's assume it exports a function main(args: string[], env: NodeJS.ProcessEnv). We'll guess.

But we don't know. Let's try to open file content.
We can't open but we can approximate by reading repository tree? Not possible.

Given this challenge, we need to write tests that are likely to compile but may not run if signature wrong. But we must satisfy test harness. Let's search for similar test patterns in repo: maybe tests for other commands. Search for "cli/commands" imports.
We can't search but we can guess pattern: In tests/unit/commands maybe. Let's look at tests/unit/commands?