import pytest

from test_behavior import act, app, prepare, state


def quarantined(app, key, charge, phase=1):
    prepare(app, key, charge, phase)
    after = act(app, "quarantine", key, "keeper-" + key)
    assert after[key]["quarantined"] is True
    return after


@pytest.mark.parametrize("phase,charge,keeper,allowed", [(1, 3, "keeper-A", True), (1, 1, "keeper-A", True), (1, 9, "keeper-A", True), (1, 4, "keeper-A", False), (1, 0, "keeper-A", False), (0, 3, "keeper-A", False), (1, 3, "wrong", False), (1, 3, "", False)])
def test_quarantine_exact_gate(app, phase, charge, keeper, allowed):
    prepare(app, "A", charge, phase)
    before = app.observe()
    after = act(app, "quarantine", "A", keeper)
    assert type(after["A"]["quarantined"]) is bool and after["A"]["quarantined"] == allowed
    if not allowed:
        assert app.observe() == before
    else:
        for field in ("keeper", "glyph", "charge", "phase", "sealed"):
            assert after["A"][field] == state_of(before)["A"][field]
        assert after["B"] == state_of(before)["B"] and after["C"] == state_of(before)["C"]
        once = app.observe()
        act(app, "quarantine", "A", keeper)
        assert app.observe() == once


def state_of(rows):
    return {row["id"]: row for row in rows}


def test_quarantine_unbound_unknown_and_sealed_are_noops(app):
    prepare(app, "B", 5, 1)
    act(app, "seal", "B", "keeper-B")
    before = app.observe()
    act(app, "quarantine", "A", "keeper-A")
    act(app, "quarantine", "unknown", "keeper-A")
    act(app, "quarantine", "B", "keeper-B")
    assert app.observe() == before
    assert all(type(row["quarantined"]) is bool and not row["quarantined"] for row in state(app).values())


def test_quarantined_vault_cannot_be_sealed_and_blocks_local_actions(app):
    quarantined(app, "A", 5)
    prepare(app, "B", 3, 0)
    before = app.observe()
    for name, args in [("seal", ("A", "keeper-A")), ("pulse", ("A", "keeper-A", 0)), ("pulse", ("A", "keeper-A", 9)), ("release", ("A", "keeper-A")), ("transfer", ("A", "B", "keeper-A", 1))]:
        act(app, name, *args)
        assert app.observe() == before, f"quarantined operation changed state: {name} {args}"
    act(app, "pulse", "A", "keeper-A", 0)
    act(app, "release", "A", "keeper-A")
    assert app.observe() == before


def test_transfer_into_quarantined_target_depends_on_source_phase(app):
    quarantined(app, "A", 3)
    prepare(app, "B", 2, 0)
    after = act(app, "transfer", "B", "A", "keeper-B", 1)
    assert (after["A"]["charge"], after["B"]["charge"]) == (4, 1)
    assert after["A"]["quarantined"] is True and after["A"]["phase"] == 1
    act(app, "rotate", "B", "keeper-B")
    after = act(app, "restart")
    assert after["A"]["quarantined"] is True and after["A"]["phase"] == 0 and after["A"]["charge"] == 4
    assert after["B"]["phase"] == 0
    act(app, "rotate", "B", "keeper-B")
    before = app.observe()
    act(app, "transfer", "B", "A", "keeper-B", 1)
    assert app.observe() == before
    act(app, "clear_quarantine", "A", "keeper-A")
    after = act(app, "transfer", "B", "A", "keeper-B", 1)
    assert (after["A"]["charge"], after["B"]["charge"]) == (5, 0)


@pytest.mark.parametrize("entry_charge,added,expected_charge,still_quarantined", [(3, 0, 3, True), (3, 1, 4, False), (5, 1, 5, True), (7, 1, 5, True), (1, 0, 1, True), (5, 4, 5, True)])
def test_rotate_return_clears_quarantine_only_on_even_charge_after_cap(app, entry_charge, added, expected_charge, still_quarantined):
    quarantined(app, "A", entry_charge)
    if added:
        prepare(app, "B", added, 0)
        assert act(app, "transfer", "B", "A", "keeper-B", added)["A"]["charge"] == entry_charge + added
    after = act(app, "rotate", "A", "keeper-A")
    assert after["A"]["phase"] == 0
    assert after["A"]["charge"] == expected_charge
    assert after["A"]["quarantined"] is still_quarantined


def test_rotate_forward_clears_quarantine_on_even_charge_without_cap(app):
    quarantined(app, "A", 3)
    prepare(app, "B", 1, 0)
    act(app, "transfer", "B", "A", "keeper-B", 1)
    act(app, "restart")
    before = state(app)
    assert before["A"]["quarantined"] is True and before["A"]["phase"] == 0 and before["A"]["charge"] == 4
    after = act(app, "rotate", "A", "keeper-A")
    assert after["A"]["phase"] == 1 and after["A"]["charge"] == 4 and after["A"]["quarantined"] is False
    quarantined(app, "C", 9)
    act(app, "restart")
    after = act(app, "rotate", "C", "keeper-C")
    assert after["C"]["phase"] == 1 and after["C"]["charge"] == 9 and after["C"]["quarantined"] is True


def test_quarantine_persists_across_restart_and_base_rules_recover_after_clearing(app):
    quarantined(app, "A", 5)
    after = act(app, "restart")
    assert after["A"]["quarantined"] is True and after["A"]["phase"] == 0 and after["A"]["charge"] == 5 and after["A"]["sealed"] is False
    before = app.observe()
    act(app, "pulse", "A", "keeper-A", 2)
    act(app, "clear_quarantine", "A", "wrong")
    act(app, "clear_quarantine", "unknown", "keeper-A")
    assert app.observe() == before
    after = act(app, "clear_quarantine", "A", "keeper-A")
    assert after["A"]["quarantined"] is False
    for field in ("keeper", "glyph", "charge", "phase", "sealed"):
        assert after["A"][field] == state_of(before)["A"][field]
    cleared = app.observe()
    act(app, "clear_quarantine", "A", "keeper-A")
    assert app.observe() == cleared
    assert act(app, "pulse", "A", "keeper-A", 2)["A"]["charge"] == 2
    act(app, "rotate", "A", "keeper-A")
    act(app, "pulse", "A", "keeper-A", 3)
    assert act(app, "seal", "A", "keeper-A")["A"]["sealed"] is True
    after = act(app, "restart")
    assert after["A"]["sealed"] is True and after["A"]["quarantined"] is False


def test_clear_quarantine_on_unbound_vault_is_noop_and_unbound_never_quarantined(app):
    before = app.observe()
    act(app, "clear_quarantine", "A", "keeper-A")
    assert app.observe() == before
    quarantined(app, "A", 1)
    act(app, "rotate", "A", "keeper-A")
    after = act(app, "rotate", "A", "keeper-A")
    assert after["A"]["quarantined"] is True
    act(app, "clear_quarantine", "A", "keeper-A")
    act(app, "rotate", "A", "keeper-A")
    act(app, "pulse", "A", "keeper-A", 0)
    after = act(app, "release", "A", "keeper-A")
    assert after["A"]["keeper"] is None and after["A"]["quarantined"] is False
    after = act(app, "bind", "A", "keeper-A", "glyph-A", 3)
    assert after["A"]["quarantined"] is False
