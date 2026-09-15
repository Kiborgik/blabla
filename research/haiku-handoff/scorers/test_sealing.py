import pytest

from test_behavior import act, app, prepare, state


@pytest.mark.parametrize("phase,charge,keeper,allowed", [(0, 5, "keeper-A", False), (1, 4, "keeper-A", False), (1, 5, "wrong", False), (1, 5, "keeper-A", True), (1, 6, "keeper-A", False)])
def test_seal_exact_gate(app, phase, charge, keeper, allowed):
    prepare(app, "A", charge, phase)
    before = app.observe()
    after = act(app, "seal", "A", keeper)
    assert type(after["A"]["sealed"]) is bool and after["A"]["sealed"] == allowed
    if not allowed:
        assert app.observe() == before
    else:
        sealed = app.observe()
        act(app, "seal", "A", keeper)
        assert app.observe() == sealed


def test_seal_unbound_and_unknown_are_noops(app):
    before = app.observe()
    act(app, "seal", "A", "keeper-A")
    act(app, "seal", "unknown", "keeper-A")
    assert app.observe() == before
    assert all(type(row["sealed"]) is bool and not row["sealed"] for row in state(app).values())


def test_sealed_blocks_both_transfer_directions_and_local_actions(app):
    prepare(app, "A", 5, 1)
    prepare(app, "B", 3, 0)
    act(app, "seal", "A", "keeper-A")
    before = app.observe()
    for name, args in [("pulse", ("A", "keeper-A", 0)), ("pulse", ("A", "keeper-A", 9)), ("rotate", ("A", "keeper-A")), ("release", ("A", "keeper-A")), ("transfer", ("A", "B", "keeper-A", 1)), ("transfer", ("B", "A", "keeper-B", 1))]:
        act(app, name, *args)
        assert app.observe() == before, f"sealed operation changed state: {name} {args}"


def test_seal_persists_but_phase_resets_then_unseal_restores_base_rules(app):
    prepare(app, "A", 5, 1)
    act(app, "seal", "A", "keeper-A")
    after = act(app, "restart")
    assert after["A"]["sealed"] is True and after["A"]["phase"] == 0 and after["A"]["charge"] == 5
    before = app.observe()
    act(app, "pulse", "A", "keeper-A", 2)
    act(app, "rotate", "A", "keeper-A")
    act(app, "unseal", "A", "wrong")
    assert app.observe() == before
    after = act(app, "unseal", "A", "keeper-A")
    assert after["A"]["sealed"] is False
    assert act(app, "pulse", "A", "keeper-A", 2)["A"]["charge"] == 2
    act(app, "pulse", "A", "keeper-A", 0)
    after = act(app, "release", "A", "keeper-A")
    assert after["A"]["keeper"] is None and after["A"]["sealed"] is False
    after = act(app, "restart")
    assert after["A"]["keeper"] is None and after["A"]["sealed"] is False
