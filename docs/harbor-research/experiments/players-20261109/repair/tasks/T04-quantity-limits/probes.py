"""Spec probes for T04. Each probe is (tag, name, thunk); tags: mutated, near, far."""

LIMITS = {"MUG": 4, "POSTER": 1}


def PROBES():
    from checkout.limits import clamp_quantity
    return [
        ("mutated", "MUG 6 (limit 4)", lambda: clamp_quantity("MUG", 6, LIMITS)),
        ("near", "MUG 5 (limit 4)", lambda: clamp_quantity("MUG", 5, LIMITS)),
        ("near", "MUG 6 (limit 10)", lambda: clamp_quantity("MUG", 6, {"MUG": 10})),
        ("near", "MUG 7 (limit 4)", lambda: clamp_quantity("MUG", 7, LIMITS)),
        ("far", "POSTER 3 (limit 1)", lambda: clamp_quantity("POSTER", 3, LIMITS)),
        ("far", "CUP 9 (limit 2)", lambda: clamp_quantity("CUP", 9, {"CUP": 2})),
        ("far", "TEE 7 (no limit)", lambda: clamp_quantity("TEE", 7, LIMITS)),
        ("far", "MUG -1", lambda: clamp_quantity("MUG", -1, LIMITS)),
        ("far", "MUG 4 (limit 4)", lambda: clamp_quantity("MUG", 4, LIMITS)),
        ("far", "HAT 12 (limit 12)", lambda: clamp_quantity("HAT", 12, {"HAT": 12})),
    ]
