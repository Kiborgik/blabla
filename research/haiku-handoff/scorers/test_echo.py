import pytest

from test_behavior import act, app, prepare, state
from test_resonance import resonant


def test_echo_moves_resonance_between_in_phase_vaults_and_leaves_charges(app):
    resonant(app, "A", 4, 2)
    resonant(app, "B", 3, 2)
    before = state(app)
    assert (before["A"]["phase"], before["A"]["resonance"], before["B"]["phase"], before["B"]["resonance"]) == (0, 2, 0, 2)
    after = act(app, "echo", "A", "B", "keeper-A")
    assert (after["A"]["resonance"], after["B"]["resonance"]) == (0, 4)
    for key in ("A", "B"):
        for field in ("keeper", "glyph", "charge", "phase", "sealed", "quarantined"):
            assert after[key][field] == before[key][field]
    assert after["C"] == before["C"]
    once = app.observe()
    act(app, "echo", "A", "B", "keeper-A")
    assert app.observe() == once


def test_echo_requires_equal_phases_unlike_transfer(app):
    resonant(app, "A", 4, 1)
    resonant(app, "B", 3, 2)
    before = state(app)
    assert (before["A"]["phase"], before["B"]["phase"]) == (1, 0)
    raw = app.observe()
    act(app, "echo", "A", "B", "keeper-A")
    assert app.observe() == raw
    after = act(app, "transfer", "A", "B", "keeper-A", 1)
    assert (after["A"]["charge"], after["B"]["charge"]) == (3, 4)
    assert (after["A"]["resonance"], after["B"]["resonance"]) == (1, 2)
    act(app, "rotate", "B", "keeper-B")
    after = act(app, "echo", "A", "B", "keeper-A")
    assert (after["A"]["resonance"], after["B"]["resonance"]) == (0, 4)


@pytest.mark.parametrize("keeper,source_rotations", [("wrong", 2), ("keeper-A", 0), ("", 2)])
def test_echo_gate_keeper_and_resonance(app, keeper, source_rotations):
    resonant(app, "A", 4, source_rotations)
    resonant(app, "B", 4, 2)
    if source_rotations % 2:
        act(app, "rotate", "B", "keeper-B")
    before = app.observe()
    act(app, "echo", "A", "B", keeper)
    assert app.observe() == before


def test_echo_same_vault_unbound_and_unknown_are_noops(app):
    resonant(app, "A", 4, 2)
    before = app.observe()
    for source, target in [("A", "A"), ("A", "B"), ("A", "unknown"), ("B", "A"), ("unknown", "A")]:
        act(app, "echo", source, target, "keeper-A")
        assert app.observe() == before, (source, target)


def test_echo_is_blocked_by_seals_and_by_a_quarantined_source(app):
    resonant(app, "A", 5, 3)
    resonant(app, "B", 5, 3)
    act(app, "seal", "B", "keeper-B")
    before = app.observe()
    act(app, "echo", "A", "B", "keeper-A")
    act(app, "echo", "B", "A", "keeper-B")
    assert app.observe() == before
    act(app, "unseal", "B", "keeper-B")
    act(app, "quarantine", "A", "keeper-A")
    before = app.observe()
    act(app, "echo", "A", "B", "keeper-A")
    assert app.observe() == before


def test_echo_into_quarantined_target_needs_both_in_phase_zero(app):
    resonant(app, "A", 3, 3)
    act(app, "quarantine", "A", "keeper-A")
    resonant(app, "B", 4, 1)
    before = state(app)
    assert (before["A"]["phase"], before["A"]["quarantined"], before["B"]["phase"], before["B"]["resonance"]) == (1, True, 1, 1)
    raw = app.observe()
    act(app, "echo", "B", "A", "keeper-B")
    assert app.observe() == raw
    after = act(app, "restart")
    assert after["A"]["phase"] == 0 and after["A"]["quarantined"] is True and after["A"]["resonance"] == 0
    act(app, "rotate", "B", "keeper-B")
    after = act(app, "rotate", "B", "keeper-B")
    assert (after["B"]["phase"], after["B"]["resonance"]) == (0, 2)
    after = act(app, "echo", "B", "A", "keeper-B")
    assert (after["A"]["resonance"], after["B"]["resonance"], after["A"]["quarantined"], after["A"]["phase"]) == (2, 0, True, 0)


def test_echo_sum_is_not_capped_and_survives_until_restart(app):
    resonant(app, "A", 4, 6)
    resonant(app, "B", 4, 6)
    after = act(app, "echo", "A", "B", "keeper-A")
    assert (after["A"]["resonance"], after["B"]["resonance"]) == (0, 12)
    after = act(app, "rotate", "B", "keeper-B")
    assert (after["B"]["phase"], after["B"]["resonance"]) == (1, 13)
    after = act(app, "attune", "B", "keeper-B")
    assert (after["B"]["charge"], after["B"]["resonance"]) == (9, 0)
    resonant(app, "C", 2, 2)
    act(app, "rotate", "A", "keeper-A")
    act(app, "rotate", "A", "keeper-A")
    act(app, "echo", "C", "A", "keeper-C")
    assert state(app)["A"]["resonance"] == 4
    after = act(app, "restart")
    assert all(row["resonance"] == 0 for row in after.values())
