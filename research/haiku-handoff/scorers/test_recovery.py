import pytest

from test_behavior import act, app, prepare, state
from test_resonance import resonant


def quarantined_with_resonance(app, key, charge, extra_rotations):
    after = resonant(app, key, charge, 1)
    assert after[key]["phase"] == 1
    after = act(app, "quarantine", key, "keeper-" + key)
    assert after[key]["quarantined"] is True
    for _ in range(extra_rotations):
        after = act(app, "rotate", key, "keeper-" + key)
    return after


@pytest.mark.parametrize("charge,extra_rotations,keeper,allowed", [(3, 2, "keeper-A", True), (3, 1, "keeper-A", False), (3, 2, "wrong", False), (5, 4, "keeper-A", True), (1, 0, "keeper-A", False)])
def test_recover_exact_gate(app, charge, extra_rotations, keeper, allowed):
    before_rows = quarantined_with_resonance(app, "A", charge, extra_rotations)
    assert before_rows["A"]["quarantined"] is True
    before = app.observe()
    after = act(app, "recover", "A", keeper)
    if allowed:
        assert after["A"]["quarantined"] is False and after["A"]["phase"] == 0 and after["A"]["resonance"] == 0
        for field in ("keeper", "glyph", "charge", "sealed"):
            assert after["A"][field] == before_rows["A"][field]
        assert after["B"] == before_rows["B"] and after["C"] == before_rows["C"]
        once = app.observe()
        act(app, "recover", "A", keeper)
        assert app.observe() == once
    else:
        assert app.observe() == before


def test_recover_requires_quarantine_even_with_resonance(app):
    resonant(app, "A", 4, 4)
    before = app.observe()
    act(app, "recover", "A", "keeper-A")
    act(app, "recover", "B", "keeper-B")
    act(app, "recover", "unknown", "keeper-A")
    assert app.observe() == before


def test_recover_does_not_apply_the_return_cap(app):
    quarantined_with_resonance(app, "A", 5, 2)
    prepare(app, "B", 4, 0)
    after = act(app, "transfer", "B", "A", "keeper-B", 2)
    assert (after["A"]["charge"], after["A"]["phase"], after["A"]["quarantined"], after["A"]["resonance"]) == (7, 1, True, 3)
    after = act(app, "recover", "A", "keeper-A")
    assert (after["A"]["charge"], after["A"]["phase"], after["A"]["quarantined"], after["A"]["resonance"]) == (7, 0, False, 0)
    after = act(app, "rotate", "A", "keeper-A")
    assert (after["A"]["charge"], after["A"]["phase"], after["A"]["resonance"]) == (7, 1, 1)
    after = act(app, "rotate", "A", "keeper-A")
    assert (after["A"]["charge"], after["A"]["phase"], after["A"]["resonance"]) == (5, 0, 0)


def test_recover_from_phase_zero_keeps_phase_zero(app):
    after = quarantined_with_resonance(app, "A", 3, 1)
    assert (after["A"]["phase"], after["A"]["charge"], after["A"]["resonance"], after["A"]["quarantined"]) == (0, 3, 2, True)
    act(app, "rotate", "A", "keeper-A")
    after = act(app, "rotate", "A", "keeper-A")
    assert (after["A"]["phase"], after["A"]["resonance"], after["A"]["quarantined"]) == (0, 4, True)
    after = act(app, "recover", "A", "keeper-A")
    assert (after["A"]["phase"], after["A"]["charge"], after["A"]["resonance"], after["A"]["quarantined"]) == (0, 3, 0, False)


def test_recover_needs_fresh_resonance_after_restart(app):
    quarantined_with_resonance(app, "A", 3, 2)
    after = act(app, "restart")
    assert (after["A"]["quarantined"], after["A"]["phase"], after["A"]["resonance"]) == (True, 0, 0)
    before = app.observe()
    act(app, "recover", "A", "keeper-A")
    assert app.observe() == before
    for _ in range(3):
        after = act(app, "rotate", "A", "keeper-A")
    assert (after["A"]["phase"], after["A"]["resonance"], after["A"]["quarantined"]) == (1, 3, True)
    after = act(app, "recover", "A", "keeper-A")
    assert (after["A"]["quarantined"], after["A"]["phase"], after["A"]["resonance"]) == (False, 0, 0)


def test_echoed_resonance_enables_recovery(app):
    quarantined_with_resonance(app, "A", 7, 0)
    after = act(app, "rotate", "A", "keeper-A")
    assert (after["A"]["charge"], after["A"]["phase"], after["A"]["resonance"], after["A"]["quarantined"]) == (5, 0, 0, True)
    resonant(app, "B", 4, 4)
    assert state(app)["B"]["phase"] == 0
    after = act(app, "echo", "B", "A", "keeper-B")
    assert (after["A"]["resonance"], after["B"]["resonance"]) == (4, 0)
    after = act(app, "recover", "A", "keeper-A")
    assert (after["A"]["quarantined"], after["A"]["phase"], after["A"]["charge"], after["A"]["resonance"]) == (False, 0, 5, 0)
    after = act(app, "rotate", "A", "keeper-A")
    assert (after["A"]["phase"], after["A"]["resonance"]) == (1, 1)
    assert act(app, "pulse", "A", "keeper-A", 0)["A"]["charge"] == 5
    after = act(app, "seal", "A", "keeper-A")
    assert after["A"]["sealed"] is True
    before = app.observe()
    act(app, "recover", "A", "keeper-A")
    assert app.observe() == before
