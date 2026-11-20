"""Read the isolated NVMe audit report and validate both copies of the GPT."""
from hashlib import sha256
import json
from pathlib import Path
import struct
import sys
from urllib.request import urlopen
from uuid import UUID
from zlib import crc32

SECTOR = 512
HEAD_SECTORS = 34
TAIL_SECTORS = 33


def read(base, path, limit):
    with urlopen(f"{base}/{path}", timeout=5) as response:
        data = response.read(limit + 1)
    if len(data) > limit:
        raise ValueError(f"oversized audit response: {path}")
    return data


def parse(region, first_sector, header_sector, other_header, sectors):
    offset = (header_sector - first_sector) * SECTOR
    sector = region[offset:offset+SECTOR]
    magic, _, length, checksum, _ = struct.unpack_from("<8sIIII", sector)
    if magic != b"EFI PART" or not 92 <= length <= SECTOR:
        raise ValueError("invalid GPT header")
    header = sector[:length]
    if crc32(header[:16] + b"\0"*4 + header[20:]) != checksum:
        raise ValueError("GPT header CRC mismatch")
    self_lba, backup, first, last, disk_id, start, count, entry, expected = struct.unpack_from(
        "<QQQQ16sQIII", sector, 24)
    if (self_lba, backup) != (header_sector, other_header) or not (HEAD_SECTORS <= first <= last < sectors - TAIL_SECTORS):
        raise ValueError("invalid GPT geometry")
    if entry < 128 or count <= 0 or start < first_sector or entry % 128:
        raise ValueError("invalid GPT entries")
    if (header_sector == 1 and start < 2) or (header_sector != 1 and start >= header_sector):
        raise ValueError("invalid GPT entries")
    offset = (start - first_sector) * SECTOR
    end = offset + count * entry
    if end > len(region) or (header_sector != 1 and end > (header_sector - first_sector) * SECTOR):
        raise ValueError("GPT entries exceed audited range")
    entries = region[offset:end]
    if crc32(entries) != expected:
        raise ValueError("GPT entries CRC mismatch")
    return (first, last, UUID(bytes_le=disk_id), entry, entries)


def collect(base):
    return validate(
        read(base, "after.head", HEAD_SECTORS * SECTOR),
        read(base, "after.tail", TAIL_SECTORS * SECTOR),
        read(base, "sectors", 32),
        read(base, "witness.sha256", 4096),
    )


def validate(head, tail, geometry, witness_data):
    if len(head) != HEAD_SECTORS * SECTOR or len(tail) != TAIL_SECTORS * SECTOR:
        raise ValueError("incomplete GPT response")
    lines = witness_data.decode("ascii").splitlines()
    witness = dict(reversed(line.split()) for line in lines)
    expected_names = {"before.head", "after.head", "before.tail", "after.tail", "sectors"}
    if len(lines) != len(expected_names) or set(witness) != expected_names:
        raise ValueError("incomplete or duplicate audit witness")
    if witness["sectors"] != sha256(geometry).hexdigest():
        raise ValueError("changed reported sector count")
    count = geometry.rstrip(b"\n")
    if not count.isdigit() or len(count) > 19 or geometry != count + b"\n":
        raise ValueError("invalid reported sector count")
    sectors = int(count)
    if sectors <= HEAD_SECTORS + TAIL_SECTORS:
        raise ValueError("invalid reported sector count")
    for name, data in (("head", head), ("tail", tail)):
        digest = sha256(data).hexdigest()
        if witness["before." + name] != digest or witness["after." + name] != digest:
            raise ValueError(f"changed GPT {name}")
    primary = parse(head, 0, 1, sectors - 1, sectors)
    if parse(tail, sectors - TAIL_SECTORS, sectors - 1, 1, sectors) != primary:
        raise ValueError("backup GPT differs from primary")
    first, last, disk_id, entry, entries = primary
    partitions = []
    for i in range(len(entries)//entry):
        block = entries[i*entry:(i+1)*entry]
        type_id, part_id, start, end, _ = struct.unpack_from("<16s16sQQQ", block)
        if not any(type_id):
            continue
        if not first <= start <= end <= last:
            raise ValueError("partition outside usable GPT sectors")
        name = block[56:128].decode("utf-16le").split("\0",1)[0]
        partitions.append({"number": i+1, "name": name, "typeGuid": str(UUID(bytes_le=type_id)),
                           "partitionGuid": str(UUID(bytes_le=part_id)), "start": start, "end": end})
    cursor = first
    free = []
    for item in sorted(partitions, key=lambda item: item["start"]):
        if item["start"] < cursor:
            raise ValueError("GPT partitions overlap")
        if item["start"] > cursor:
            free.append({"start": cursor, "end": item["start"]-1})
        cursor = item["end"]+1
    if cursor <= last:
        free.append({"start": cursor, "end": last})
    return {"schema": "awai.pc.nvme.audit.v1", "sectorBytes": SECTOR, "sectors": sectors,
            "diskGuid": str(disk_id), "firstUsableLba": first, "lastUsableLba": last,
            "partitions": partitions, "free": free, "witness": witness, "gptUnchanged": True}


if __name__ == "__main__":
    base, path = sys.argv[1:]
    report = collect(base)
    with Path(path).open("x") as output:
        json.dump(report, output, indent=2)
        output.write("\n")
