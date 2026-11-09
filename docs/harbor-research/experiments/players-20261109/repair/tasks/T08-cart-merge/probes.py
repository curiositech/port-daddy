"""Spec probes for T08. Each probe is (tag, name, thunk); tags: mutated, near, far."""


def PROBES():
    from checkout.merge import merge_carts
    return [
        ("mutated", "{TEE:1} + {TEE:2}", lambda: merge_carts({"TEE": 1}, {"TEE": 2}, {})),
        ("near", "{TEE:1} + {TEE:2} limit 10", lambda: merge_carts({"TEE": 1}, {"TEE": 2}, {"TEE": 10})),
        ("near", "{TEE:2} + {TEE:1}", lambda: merge_carts({"TEE": 2}, {"TEE": 1}, {})),
        ("near", "{TEE:1} + {TEE:3}", lambda: merge_carts({"TEE": 1}, {"TEE": 3}, {})),
        ("far", "{MUG:2} + {MUG:5}", lambda: merge_carts({"MUG": 2}, {"MUG": 5}, {})),
        ("far", "{A:1,B:2} + {B:3,C:1} limit B:4", lambda: merge_carts({"A": 1, "B": 2}, {"B": 3, "C": 1}, {"B": 4})),
        ("far", "{X:0} + {X:0}", lambda: merge_carts({"X": 0}, {"X": 0}, {})),
        ("far", "{HAT:5} + {} limit 2", lambda: merge_carts({"HAT": 5}, {}, {"HAT": 2})),
        ("far", "{} + {CAP:4}", lambda: merge_carts({}, {"CAP": 4}, {})),
        ("far", "{SOCK:6} + {SOCK:6} limit 10", lambda: merge_carts({"SOCK": 6}, {"SOCK": 6}, {"SOCK": 10})),
    ]
