import importlib.util
import json
from pathlib import Path
import ssl
from tempfile import TemporaryDirectory
import unittest
import xml.etree.ElementTree as ET
from zipfile import ZipFile


module_path = Path(__file__).with_name("verify-selinux-policy.py")
spec = importlib.util.spec_from_file_location("verify_selinux_policy", module_path)
verifier = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verifier)


class PolicyVerificationTest(unittest.TestCase):
    def setUp(self):
        workspace = TemporaryDirectory()
        self.addCleanup(workspace.cleanup)
        root = Path(workspace.name)
        self.source = root / "source"
        self.release = root / "release"
        self.source.mkdir()
        self.release.mkdir()
        self.key_plan = root / "key-plan.json"
        self.prepared = root / "prepared.zip"
        self.signed = root / "signed.zip"
        self.roles = sorted(verifier.REQUIRED_ROLES)
        self.key_plan.write_text(json.dumps({"apkMapping": {role: role for role in self.roles}}))
        for role in self.roles:
            for directory in (self.source, self.release):
                der = f"{directory.name}:{role}".encode()
                (directory / f"{role}.x509.pem").write_text(ssl.DER_cert_to_PEM_cert(der))
        self.write_archive(self.prepared, self.source)

    def write_archive(self, path, certs):
        policy = ET.Element("policy")
        for role in self.roles:
            signer = ET.SubElement(policy, "signer", signature=verifier.certificate_hex(certs / f"{role}.x509.pem"))
            ET.SubElement(signer, "seinfo", value=role)
        addon = ET.SubElement(policy, "signer", signature="deadbeef")
        ET.SubElement(addon, "seinfo", value="unchanged")
        with ZipFile(path, "w") as archive:
            archive.writestr("SYSTEM/etc/selinux/plat_mac_permissions.xml", ET.tostring(policy))

    def test_accepts_updated_certificates(self):
        self.write_archive(self.signed, self.release)
        receipt = verifier.verify(self.prepared, self.signed, self.source, self.release, [self.key_plan])
        self.assertEqual(receipt["roles"], self.roles)
        self.assertEqual(receipt["substitutions"], len(self.roles))

    def test_rejects_unchanged_policy_in_signed_archive(self):
        self.write_archive(self.signed, self.source)
        with self.assertRaisesRegex(ValueError, "certificate substitutions do not match"):
            verifier.verify(self.prepared, self.signed, self.source, self.release, [self.key_plan])


if __name__ == "__main__":
    unittest.main()
