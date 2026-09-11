"""Print reproducible synthetic case results to stdout; never write or actuate."""
import json
from consequence import analyze
from fixtures import access, analytics, encrypted_replay
from temporal import project


def main():
    """Run the bounded offline episodes with explicit expectations and exit on drift."""
    results = []
    for name, records, proposal, expected in [
        ("analytics-preserved", analytics(), [], False),
        ("analytics-removal", analytics(), ["remove-clickhouse"], True),
        ("remote-ciphertext", encrypted_replay(), ["store-ciphertext-remotely"], False),
        ("server-decryption", encrypted_replay(), ["server-decrypt"], True),
    ]:
        state = project(records, tenant="tenant-a", project_id="same-project", principal="alice",
                        access=access(), epoch=1, as_of=len(records), effective_at=100)
        result = analyze(state, proposal)
        if result["conflict"] != expected:
            raise AssertionError(name)
        results.append({"case": name, "expectedConflict": expected, **result})
    print(json.dumps({"method": "synthetic offline fixtures; no empirical H1-H4 result", "results": results}, indent=2))


if __name__ == "__main__":
    main()
