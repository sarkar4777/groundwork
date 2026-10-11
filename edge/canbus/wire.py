"""What a CAN 2.0B extended frame looks like on the copper: its exact bit stream, CRC-15 and stuff bits."""

from __future__ import annotations


def crc15(bits: list[int]) -> int:
    """ISO 11898-1 CRC-15, polynomial x^15 + x^14 + x^10 + x^8 + x^7 + x^4 + x^3 + 1 (0x4599)."""
    crc = 0
    for b in bits:
        nxt = b ^ ((crc >> 14) & 1)
        crc = (crc << 1) & 0x7FFF
        if nxt:
            crc ^= 0x4599
    return crc


def _bits(v: int, n: int) -> list[int]:
    return [(v >> (n - 1 - i)) & 1 for i in range(n)]


def frame_bits(can_id: int, data: bytes) -> tuple[int, int]:
    """Total bits on the wire and how many of them are stuff bits, for an extended data frame.

    SOF, base id (11), SRR, IDE, extended id (18), RTR, r1, r0, DLC (4), data, CRC (15) are stuffed: after five
    equal bits the transmitter inserts one of the opposite level. CRC delimiter, ACK slot and delimiter, EOF (7)
    and the 3-bit intermission are not.
    """
    dlc = len(data)
    base, ext = (can_id >> 18) & 0x7FF, can_id & 0x3FFFF
    head = [0] + _bits(base, 11) + [1, 1] + _bits(ext, 18) + [0, 0, 0] + _bits(dlc, 4)
    for byte in data:
        head += _bits(byte, 8)
    stuffed = head + _bits(crc15(head), 15)
    stuff = 0
    run_bit, run = None, 0
    for b in stuffed:
        if b == run_bit:
            run += 1
        else:
            run_bit, run = b, 1
        if run == 5:
            stuff += 1
            run_bit, run = 1 - b, 1
    return len(stuffed) + stuff + 1 + 2 + 7 + 3, stuff


# an active error flag (6 dominant), the echo of other nodes' flags (up to 6), delimiter (8) and intermission (3)
ERROR_FRAME_BITS = 6 + 6 + 8 + 3
