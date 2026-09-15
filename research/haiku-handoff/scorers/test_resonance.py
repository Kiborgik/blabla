import pytest

from test_behavior import act, app, prepare, state


def resonant(app, key, charge, rotations):
    prepare(app, key, charge)
    after = state(app)
    for _ in range(rotations):
        after = act(app, "rotate", key, "keeper-" + key)
    return after


def test_resonance_is_observable_and_zero_for_unbound_and_fresh_vaults(app):
    for row in state(app).values():
        assert type(row["resonance"]) is int and row["resonance"] == 0
    after = act(app, "bind", "A", "keeper-A", "glyph-A", 4)
    assert after["A"]["resonance"] == 0


def test_rotate_builds_resonance_until_the_return_cap_resets_it(app):
    after = resonant(app, "A", 4, 3)
    assert (after["A"]["phase"], after["A"]["charge"], after["A"]["resonance"]) == (1, 4, 3)
    after = act(app, "rotate", "A", "keeper-A")
    assert (after["A"]["phase"], after["A"]["charge"], after["A"]["resonance"]) == (0, 4, 4)
    after = resonant(app, "B", 8, 1)
    assert (after["B"]["phase"], after["B"]["charge"], after["B"]["resonance"]) == (1, 8, 1)
    after = act(app, "rotate", "B", "keeper-B")
    assert (after["B"]["phase"], after["B"]["charge"], after["B"]["resonance"]) == (0, 5, 0)
    after = act(app, "rotate", "B", "keeper-B")
    assert (after["B"]["phase"], after["B"]["charge"], after["B"]["resonance"]) == (1, 5, 1)


def test_rotate_at_exactly_five_keeps_building(app):
    after = resonant(app, "A", 5, 4)
    assert (after["A"]["phase"], after["A"]["charge"], after["A"]["resonance"]) == (0, 5, 4)


def test_pulse_resets_resonance_only_in_phase_zero(app):
    after = resonant(app, "A", 4, 2)
    assert (after["A"]["phase"], after["A"]["resonance"]) == (0, 2)
    after = act(app, "pulse", "A", "keeper-A", 3)
    assert (after["A"]["charge"], after["A"]["resonance"]) == (3, 0)
    after = act(app, "rotate", "A", "keeper-A")
    assert (after["A"]["phase"], after["A"]["resonance"]) == (1, 1)
    after = act(app, "pulse", "A", "keeper-A", 2)
    assert (after["A"]["charge"], after["A"]["resonance"]) == (5, 1)
    after = act(app, "pulse", "A", "keeper-A", 9)
    assert (after["A"]["charge"], after["A"]["resonance"]) == (9, 1)
    resonant(app, "B", 2, 2)
    before = app.observe()
    act(app, "pulse", "B", "wrong", 1)
    act(app, "pulse", "B", "keeper-B", 10)
    assert app.observe() == before


def test_pulse_in_phase_zero_resets_even_when_charge_is_unchanged(app):
    after = resonant(app, "A", 4, 2)
    assert after["A"]["resonance"] == 2
    after = act(app, "pulse", "A", "keeper-A", 4)
    assert (after["A"]["charge"], after["A"]["resonance"]) == (4, 0)


@pytest.mark.parametrize("charge,rotations,keeper,allowed,expected_charge", [(3, 3, "keeper-A", True, 6), (5, 3, "keeper-A", True, 8), (9, 1, "keeper-A", False, 9), (4, 1, "keeper-A", False, 4), (4, 2, "keeper-A", False, 4), (3, 3, "wrong", False, 3)])
def test_attune_exact_gate_and_effect(app, charge, rotations, keeper, allowed, expected_charge):
    before_rows = resonant(app, "A", charge, rotations)
    before = app.observe()
    after = act(app, "attune", "A", keeper)
    assert after["A"]["charge"] == expected_charge
    if allowed:
        assert after["A"]["resonance"] == 0
        for field in ("keeper", "glyph", "phase", "sealed", "quarantined"):
            assert after["A"][field] == before_rows["A"][field]
        assert after["B"] == before_rows["B"] and after["C"] == before_rows["C"]
        once = app.observe()
        act(app, "attune", "A", keeper)
        assert app.observe() == once
    else:
        assert app.observe() == before


def test_attune_caps_charge_at_nine(app):
    after = resonant(app, "A", 5, 3)
    assert (after["A"]["phase"], after["A"]["charge"], after["A"]["resonance"]) == (1, 5, 3)
    after = act(app, "pulse", "A", "keeper-A", 4)
    assert (after["A"]["charge"], after["A"]["resonance"]) == (9, 3)
    after = act(app, "attune", "A", "keeper-A")
    assert (after["A"]["charge"], after["A"]["resonance"]) == (9, 0)


def test_attune_is_blocked_by_seal_and_quarantine_and_keeps_their_resonance(app):
    after = resonant(app, "A", 5, 3)
    after = act(app, "seal", "A", "keeper-A")
    assert after["A"]["sealed"] is True and after["A"]["resonance"] == 3
    before = app.observe()
    act(app, "attune", "A", "keeper-A")
    assert app.observe() == before
    after = act(app, "unseal", "A", "keeper-A")
    assert after["A"]["resonance"] == 3
    after = act(app, "attune", "A", "keeper-A")
    assert (after["A"]["charge"], after["A"]["resonance"]) == (8, 0)
    after = resonant(app, "B", 3, 3)
    after = act(app, "quarantine", "B", "keeper-B")
    assert after["B"]["quarantined"] is True and after["B"]["resonance"] == 3
    before = app.observe()
    act(app, "attune", "B", "keeper-B")
    assert app.observe() == before
    after = act(app, "rotate", "B", "keeper-B")
    assert (after["B"]["phase"], after["B"]["charge"], after["B"]["quarantined"], after["B"]["resonance"]) == (0, 3, True, 4)
    after = act(app, "clear_quarantine", "B", "keeper-B")
    assert after["B"]["resonance"] == 4
    after = act(app, "rotate", "B", "keeper-B")
    assert (after["B"]["phase"], after["B"]["resonance"]) == (1, 5)
    after = act(app, "attune", "B", "keeper-B")
    assert (after["B"]["charge"], after["B"]["resonance"]) == (8, 0)


def test_attune_on_unbound_and_unknown_vaults_is_noop(app):
    prepare(app, "B", 4)
    before = app.observe()
    act(app, "attune", "A", "keeper-A")
    act(app, "attune", "unknown", "keeper-A")
    act(app, "attune", "B", "keeper-B")
    assert app.observe() == before


def test_transfer_keeps_resonance_on_both_vaults(app):
    resonant(app, "A", 4, 2)
    resonant(app, "B", 2, 1)
    before = state(app)
    assert (before["A"]["phase"], before["A"]["resonance"], before["B"]["phase"], before["B"]["resonance"]) == (0, 2, 1, 1)
    after = act(app, "transfer", "A", "B", "keeper-A", 3)
    assert (after["A"]["charge"], after["B"]["charge"]) == (1, 5)
    assert (after["A"]["resonance"], after["B"]["resonance"]) == (2, 1)


def test_release_clears_resonance_after_transferring_all_charge(app):
    resonant(app, "A", 2, 2)
    resonant(app, "B", 5, 1)
    after = act(app, "transfer", "A", "B", "keeper-A", 2)
    assert (after["A"]["charge"], after["A"]["resonance"]) == (0, 2)
    after = act(app, "release", "A", "keeper-A")
    assert after["A"]["keeper"] is None and after["A"]["resonance"] == 0
    before = app.observe()
    act(app, "release", "B", "keeper-B")
    assert app.observe() == before
    assert state(app)["B"]["resonance"] == 1


def test_restart_resets_resonance_and_preserves_durable_fields(app):
    resonant(app, "A", 4, 3)
    resonant(app, "B", 3, 3)
    act(app, "quarantine", "B", "keeper-B")
    before = state(app)
    assert before["A"]["resonance"] == 3 and before["B"]["resonance"] == 3
    after = act(app, "restart")
    for key in before:
        assert after[key]["resonance"] == 0 and after[key]["phase"] == 0
        for field in ("keeper", "glyph", "charge", "sealed", "quarantined"):
            assert after[key][field] == before[key][field]
    after = act(app, "rotate", "A", "keeper-A")
    assert after["A"]["resonance"] == 1
    act(app, "rotate", "A", "keeper-A")
    after = act(app, "rotate", "A", "keeper-A")
    assert (after["A"]["phase"], after["A"]["resonance"]) == (1, 3)
    after = act(app, "attune", "A", "keeper-A")
    assert (after["A"]["charge"], after["A"]["resonance"]) == (7, 0)
