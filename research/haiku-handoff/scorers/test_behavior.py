import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from driver import Session


def state(app):
    rows = app.observe()
    assert len(rows) == 3 and {row["id"] for row in rows} == {"A", "B", "C"}
    bound_glyphs = []
    for row in rows:
        assert type(row["charge"]) is int and 0 <= row["charge"] <= 9
        assert type(row["phase"]) is int and row["phase"] in (0, 1)
        if "resonance" in row:
            assert type(row["resonance"]) is int and row["resonance"] >= 0
        if row["keeper"] is None:
            assert row["glyph"] is None and row["charge"] == 0 and row["phase"] == 0
            assert row.get("resonance", 0) == 0
        else:
            assert type(row["keeper"]) is str and type(row["glyph"]) is str
            bound_glyphs.append(row["glyph"])
    assert len(bound_glyphs) == len(set(bound_glyphs))
    return {row["id"]: row for row in rows}


def act(app, action, *args):
    app.call(action, *args)
    return state(app)


@pytest.fixture
def app():
    session = Session()
    try:
        for row in state(session).values():
            if row["keeper"] is not None:
                if row.get("sealed"):
                    act(session, "unseal", row["id"], row["keeper"])
                if row.get("quarantined"):
                    act(session, "clear_quarantine", row["id"], row["keeper"])
                if row["phase"] == 1:
                    act(session, "rotate", row["id"], row["keeper"])
                act(session, "pulse", row["id"], row["keeper"], 0)
                act(session, "release", row["id"], row["keeper"])
        yield session
    finally:
        session.close()


def prepare(app, key, charge, phase=0):
    act(app, "bind", key, "keeper-" + key, "glyph-" + key, max(charge, 1))
    if charge == 0:
        act(app, "pulse", key, "keeper-" + key, 0)
    if phase:
        act(app, "rotate", key, "keeper-" + key)


@pytest.mark.parametrize("charge,success", [(-1, False), (0, False), (1, True), (9, True), (10, False), (9007199254740991, False)])
def test_bind_bounds_and_exact_failure(app, charge, success):
    before = app.observe()
    after = act(app, "bind", "A", "", "é", charge)
    if success:
        assert after["A"] == {"id": "A", "keeper": "", "glyph": "é", "charge": charge, "phase": 0, **({"sealed": False} if "sealed" in after["A"] else {}), **({"quarantined": False} if "quarantined" in after["A"] else {}), **({"resonance": 0} if "resonance" in after["A"] else {})}
    else:
        assert app.observe() == before


def test_exclusive_glyph_rebinding_and_frame(app):
    prepare(app, "A", 4)
    before = app.observe()
    act(app, "bind", "A", "new", "new", 3)
    assert app.observe() == before
    act(app, "bind", "B", "other", "glyph-A", 3)
    assert app.observe() == before
    act(app, "pulse", "A", "keeper-A", 0)
    act(app, "release", "A", "keeper-A")
    after = act(app, "bind", "B", "other", "glyph-A", 3)
    assert after["B"]["glyph"] == "glyph-A" and after["B"]["charge"] == 3
    assert after["A"]["keeper"] is None and after["C"]["keeper"] is None


@pytest.mark.parametrize("phase,charge,amount,expected", [(0, 8, 2, 2), (0, 2, 9, 9), (0, 9, 0, 0), (1, 8, 2, 9), (1, 2, 3, 5), (1, 4, 0, 4), (1, 0, 9, 9)])
def test_phase_dependent_pulse(app, phase, charge, amount, expected):
    prepare(app, "A", charge, phase)
    before = state(app)
    after = act(app, "pulse", "A", "keeper-A", amount)
    assert after["A"]["charge"] == expected and after["A"]["phase"] == phase
    assert after["B"] == before["B"] and after["C"] == before["C"]


@pytest.mark.parametrize("phase,charge,expected", [(0, 9, 9), (0, 0, 0), (1, 4, 4), (1, 5, 5), (1, 6, 5), (1, 9, 5)])
def test_rotate_toggle_and_return_cap(app, phase, charge, expected):
    prepare(app, "A", charge, phase)
    after = act(app, "rotate", "A", "keeper-A")
    assert after["A"]["phase"] == 1 - phase and after["A"]["charge"] == expected


@pytest.mark.parametrize("action,args", [("bind", ("missing", "k", "g", 4)), ("pulse", ("missing", "k", 4)), ("pulse", ("A", "wrong", 4)), ("pulse", ("A", "keeper-A", -1)), ("pulse", ("A", "keeper-A", 10)), ("rotate", ("A", "wrong")), ("release", ("A", "wrong")), ("release", ("A", "keeper-A")), ("transfer", ("A", "B", "keeper-A", 2))])
def test_invalid_actions_are_exact_noops(app, action, args):
    prepare(app, "A", 4)
    before = app.observe()
    act(app, action, *args)
    assert app.observe() == before


@pytest.mark.parametrize("source_charge,target_charge,target_phase,keeper,amount,expected", [(4, 8, 1, "keeper-A", 2, (4, 8)), (4, 7, 1, "keeper-A", 2, (2, 9)), (4, 2, 1, "keeper-A", 4, (0, 6)), (4, 8, 0, "keeper-A", 1, (4, 8)), (4, 2, 1, "wrong", 2, (4, 2)), (4, 2, 1, "keeper-A", 0, (4, 2)), (4, 2, 1, "keeper-A", -1, (4, 2)), (4, 2, 1, "keeper-A", 5, (4, 2))])
def test_transfer_atomicity_and_independent_charge_outcomes(app, source_charge, target_charge, target_phase, keeper, amount, expected):
    prepare(app, "A", source_charge)
    prepare(app, "B", target_charge, target_phase)
    prepare(app, "C", 6, 1)
    before = state(app)
    raw = app.observe()
    after = act(app, "transfer", "A", "B", keeper, amount)
    assert (after["A"]["charge"], after["B"]["charge"]) == expected
    assert after["C"] == before["C"]
    for key in ("A", "B"):
        for field in ("id", "keeper", "glyph", "phase"):
            assert after[key][field] == before[key][field]
    if expected == (source_charge, target_charge):
        assert app.observe() == raw


def test_transfer_same_id_and_unbound_source_are_noops(app):
    prepare(app, "B", 8, 1)
    before = app.observe()
    act(app, "transfer", "A", "B", "keeper-A", 2)
    assert app.observe() == before
    act(app, "transfer", "B", "B", "keeper-B", 2)
    assert app.observe() == before


def test_release_requires_zero_and_clears_transient_state(app):
    prepare(app, "A", 1)
    act(app, "pulse", "A", "keeper-A", 0)
    act(app, "rotate", "A", "keeper-A")
    before = app.observe()
    act(app, "release", "A", "wrong")
    assert app.observe() == before
    after = act(app, "release", "A", "keeper-A")
    assert after["A"]["keeper"] is None and after["A"]["glyph"] is None
    assert after["A"]["charge"] == 0 and after["A"]["phase"] == 0


def test_restart_preserves_durable_values_without_rotate_cap(app):
    prepare(app, "A", 9, 1)
    act(app, "bind", "B", "", "", 4)
    before = state(app)
    after = act(app, "restart")
    for key in before:
        assert after[key]["phase"] == 0
        for field in ("keeper", "glyph", "charge"):
            assert after[key][field] == before[key][field]
    assert after["A"]["charge"] == 9
    assert act(app, "pulse", "A", "keeper-A", 2)["A"]["charge"] == 2


def test_empty_keeper_and_glyph_are_bound_tokens_through_every_operation(app):
    act(app, "bind", "A", "", "", 4)
    prepare(app, "B", 3, 1)
    assert act(app, "transfer", "A", "B", "", 2)["A"]["charge"] == 2
    assert act(app, "pulse", "A", "", 6)["A"]["charge"] == 6
    assert act(app, "rotate", "A", "")["A"]["phase"] == 1
    assert act(app, "pulse", "A", "", 2)["A"]["charge"] == 8
    assert act(app, "rotate", "A", "")["A"]["charge"] == 5
    act(app, "pulse", "A", "", 0)
    assert act(app, "release", "A", "")["A"]["keeper"] is None


def test_unknown_and_unbound_vaults_are_exact_noops(app):
    prepare(app, "A", 4)
    before = app.observe()
    for name, args in [("rotate", ("unknown", "x")), ("release", ("unknown", "x")), ("pulse", ("B", "x", 3)), ("rotate", ("B", "x")), ("release", ("B", "x")), ("transfer", ("unknown", "A", "x", 1)), ("transfer", ("A", "unknown", "keeper-A", 1))]:
        act(app, name, *args)
        assert app.observe() == before
