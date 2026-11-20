#!/usr/bin/env python3
"""Read back certificate substitutions in an Awai PC release's SELinux app policies."""

import argparse
import hashlib
import json
from pathlib import Path
import re
import ssl
import xml.etree.ElementTree as ET
from zipfile import BadZipFile, ZipFile


REQUIRED_ROLES = {"platform", "networkstack", "media", "bluetooth", "nfc", "sdk_sandbox"}


def certificate_hex(path):
    return ssl.PEM_cert_to_DER_cert(path.read_text(encoding="ascii")).hex()


def certificate_substitutions(source_root, release_root, key_plans):
    substitutions = {}
    for path in key_plans:
        plan = json.loads(path.read_text(encoding="utf-8"))
        for source, role in plan["apkMapping"].items():
            relative = Path(source)
            if relative.is_absolute() or ".." in relative.parts:
                raise ValueError(f"expected a relative AOSP key path: {source}")
            if not re.fullmatch(r"[A-Za-z0-9_-]+", role):
                raise ValueError(f"invalid signing role: {role}")
            public = source_root / (source + ".x509.pem")
            if not public.is_file():
                if role in REQUIRED_ROLES:
                    raise ValueError(f"missing original public certificate for {role}")
                continue
            before = certificate_hex(public)
            after = certificate_hex(release_root / (role + ".x509.pem"))
            if before == after:
                raise ValueError(f"release certificate for {role} matches the original")
            if before in substitutions and substitutions[before] != (after, role):
                raise ValueError(f"ambiguous certificate substitution for {source}")
            substitutions[before] = (after, role)
    return substitutions


def policy_names(archive):
    names = sorted(name for name in archive.namelist() if name.endswith("_mac_permissions.xml"))
    if len(names) != len(set(names)):
        raise ValueError("duplicate SELinux app policy in target-files")
    return names


def verify(prepared, signed, source_root, release_root, key_plans):
    replacements = certificate_substitutions(source_root, release_root, key_plans)
    policies = {}
    roles = set()
    with ZipFile(prepared) as original, ZipFile(signed) as result:
        names = policy_names(original)
        if names != policy_names(result):
            raise ValueError("SELinux app policy inventory changed")

        for name in names:
            expected = ET.fromstring(original.read(name))
            actual = ET.fromstring(result.read(name))
            changes = []
            for signer in expected.findall("signer"):
                old = signer.attrib["signature"].lower()
                if old not in replacements:
                    continue
                new, role = replacements[old]
                signer.set("signature", new)
                roles.add(role)
                changes.append({
                    "role": role,
                    "sourceCertSha256": hashlib.sha256(bytes.fromhex(old)).hexdigest(),
                    "releaseCertSha256": hashlib.sha256(bytes.fromhex(new)).hexdigest(),
                })
            signatures = [node.attrib["signature"].lower() for node in actual.findall("signer")]
            if len(signatures) != len(set(signatures)):
                raise ValueError(f"duplicate signer in {name}")
            if ET.canonicalize(ET.tostring(expected)) != ET.canonicalize(ET.tostring(actual)):
                raise ValueError(f"certificate substitutions do not match in {name}")
            if changes:
                policies[name] = changes

    if REQUIRED_ROLES - roles:
        raise ValueError(f"missing certificate substitutions: {', '.join(sorted(REQUIRED_ROLES - roles))}")
    return {"policies": policies, "roles": sorted(roles), "substitutions": sum(map(len, policies.values()))}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("prepared", type=Path)
    parser.add_argument("signed", type=Path)
    parser.add_argument("--source-certs", type=Path, required=True)
    parser.add_argument("--release-certs", type=Path, required=True)
    parser.add_argument("--key-plan", type=Path, action="append", required=True)
    args = parser.parse_args()
    try:
        receipt = verify(args.prepared, args.signed, args.source_certs, args.release_certs, args.key_plan)
    except (BadZipFile, ET.ParseError, KeyError, OSError, ValueError) as error:
        parser.exit(1, f"{error}\n")
    print(json.dumps(receipt, indent=2))


if __name__ == "__main__":
    main()
