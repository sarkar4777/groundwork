import random

import pytest
from twin import j1939 as J
from twin import sparkplug as SP


def _sample(spn, rnd):
    hi = spn.maxv * spn.scale + spn.offset
    lo = spn.offset
    return lo + rnd.random() * (hi - lo)


@pytest.mark.parametrize("pgn", sorted(p for p, d in J.PGNS.items() if d.spns))
def test_pgn_round_trip(pgn):
    rnd = random.Random(pgn)
    d = J.PGNS[pgn]
    for _ in range(300):
        vals = {s.name: _sample(s, rnd) for s in d.spns}
        data = J.encode(pgn, vals)
        assert len(data) == 8
        back = J.decode(pgn, data)
        for s in d.spns:
            assert back[s.name] is not None
            assert abs(back[s.name] - vals[s.name]) <= s.scale / 2 + 1e-6, (d.acronym, s.name)


def test_missing_spn_is_not_available():
    data = J.encode(J.EEC1.pgn, {"engine_speed_rpm": 1500})
    assert data[3:5] == (1500 * 8).to_bytes(2, "little")
    assert data[1] == 0xFF and data[2] == 0xFF
    back = J.decode(J.EEC1.pgn, data)
    assert back["engine_speed_rpm"] == 1500
    assert back["actual_torque_pct"] is None


def test_known_bytes():
    # 1800 rpm is 14400 = 0x3840, little-endian in bytes 4 and 5 of EEC1
    assert J.encode(J.EEC1.pgn, {"engine_speed_rpm": 1800})[3:5] == b"\x40\x38"
    # 90 C coolant is 130 with the -40 offset
    assert J.encode(J.ET1.pgn, {"coolant_c": 90})[0] == 130
    # latitude 45 deg is (45 + 210) / 1e-7
    assert int.from_bytes(J.encode(J.VP.pgn, {"latitude_deg": 45.0})[0:4], "little") == 2_550_000_000


@pytest.mark.parametrize("pgn,sa", [(61444, 0), (65262, 0), (65267, 0x4A), (65226, 0x80), (65297, 0x81), (60416, 0x03)])
def test_can_id_round_trip(pgn, sa):
    pri = J.PGNS[pgn].priority
    cid = J.can_id(pri, pgn, sa)
    assert cid < (1 << 29)
    p, g, s, _ = J.parse_can_id(cid)
    assert (p, g, s) == (pri, pgn, sa)


def test_eec1_can_id_matches_the_standard():
    assert J.can_id(3, 61444, 0) == 0x0CF00400


def test_dm1_single_and_none():
    data = J.encode_dm1(J.lamp_byte(amber=1), [J.Dtc(1638, 16, 3)])
    assert len(data) == 8
    lamps, dtcs = J.decode_dm1(data)
    assert lamps["amber_warning"] == 1 and dtcs == [J.Dtc(1638, 16, 3)]
    lamps, dtcs = J.decode_dm1(J.encode_dm1(J.lamp_byte(), []))
    assert dtcs == []


def test_dm1_spn_high_bits():
    d = J.Dtc(520200, 0, 1)
    assert J.Dtc.unpack(d.pack()) == d
    assert d.pack()[2] >> 5 == (520200 >> 16) & 0x7


def test_dm1_multi_dtc_goes_over_bam():
    dtcs = [J.Dtc(639, 9), J.Dtc(584, 2), J.Dtc(1638, 0, 4)]
    frames = J.dm1_frames(J.lamp_byte(mil=1, red_stop=1), dtcs)
    assert frames[0][0] == J.TP_CM.pgn and frames[0][1][0] == 32
    assert all(f[0] == J.TP_DT.pgn for f in frames[1:])
    pgn, payload = J.bam_reassemble(frames)
    assert pgn == J.DM1.pgn
    lamps, back = J.decode_dm1(payload)
    assert back == dtcs and lamps["red_stop"] == 1


def test_sparkplug_round_trip():
    b = SP.encode_payload(1_790_000_000_000, [("wind_ms", 12.5, SP.FLOAT), ("ok", True, SP.BOOLEAN), ("bdSeq", 7, SP.UINT64),
                                              ("kind", "anemometer", SP.STRING)], 300)
    d = SP.decode_payload(b)
    assert d["timestamp"] == 1_790_000_000_000 and d["seq"] == 300 % 256
    vals = {m["name"]: m["value"] for m in d["metrics"]}
    assert vals["wind_ms"] == pytest.approx(12.5)
    assert vals["ok"] is True and vals["bdSeq"] == 7 and vals["kind"] == "anemometer"
    assert SP.topic("DDATA", "WS-TC1") == "spBv1.0/northgate/DDATA/site-gw1/WS-TC1"
