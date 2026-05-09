# Ephemeral CI Database Port Claim

This example wraps the port-management part of a local or CI Postgres test
database.

The script claims a semantic Port Daddy identity like `ci:postgres:12345`,
builds a `DATABASE_URL`, and prints the Docker command that would start the
database on that claimed port. By default it is safe and dry-run. Pass `--run`
when Docker is installed and you want to actually start the container.

## Run It

Dry-run the flow:

```bash
bash examples/ephemeral-ci-db/ephemeral-postgres.sh
```

Run a real container:

```bash
bash examples/ephemeral-ci-db/ephemeral-postgres.sh --run
```

Use the current CI run id as the semantic identity:

```bash
GITHUB_RUN_ID=12345 bash examples/ephemeral-ci-db/ephemeral-postgres.sh --run
```

## What It Demonstrates

- claim a collision-free local port for a semantic service id
- keep repeated runs of the same CI id stable
- inject the claimed port into `DATABASE_URL`
- release the claim when the test run is finished

Use this pattern for Postgres, Redis, Selenium, fake S3, local web previews, or
any test service where fixed ports turn parallel CI into a coin toss.
