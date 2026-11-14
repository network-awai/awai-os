import importlib.util
import os
from pathlib import Path
import struct
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import uuid

spec=importlib.util.spec_from_file_location('installer_boot',Path(__file__).parents[2]/'nixos/otehon/installer-boot.py')
b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)
GUID='12345678-1234-5678-9abc-0123456789ab'

class Boot(unittest.TestCase):
    def test_gpt_esp_identity_is_read_from_admitted_descriptor(self):
        image=bytearray(1536);image[512:520]=b'EFI PART'
        struct.pack_into('<QII',image,512+72,2,128,128)
        image[1024:1040]=uuid.UUID('c12a7328-f81f-11d2-ba4b-00a0c93ec93b').bytes_le
        image[1040:1056]=uuid.UUID(GUID).bytes_le
        with tempfile.TemporaryFile() as f:
            f.write(image);f.flush();self.assertEqual(b.esp_guid(f.fileno()),GUID)
            f.seek(1024);f.write(b'\0'*16);f.flush()
            with self.assertRaises(b.Refused):b.esp_guid(f.fileno())
    def test_exact_active_entry_and_boot_order_readback(self):
        listing=f'BootOrder: 0004,0001\nBoot0001* ubuntu HD(1,GPT,{GUID},0x800,0x200000)/File(\\EFI\\ubuntu\\shimx64.efi)\nBoot0004* Awai Otehon\tHD(1,GPT,{GUID},0x800,0x200000)/File({b.LOADER})\n'
        self.assertEqual(b.verified_entry(listing,GUID),'0004')
        raw_path=listing.replace('File('+b.LOADER+')',b.LOADER)
        self.assertEqual(b.verified_entry(raw_path,GUID),'0004')
        for broken in [raw_path.replace(b.LOADER,b.LOADER+'.other'),raw_path.replace(b.LOADER,b.LOADER+r'\extra'),raw_path.replace('HD(1,GPT','HD(2,GPT')]:
            with self.subTest(broken=broken),self.assertRaises(b.Refused):b.verified_entry(broken,GUID)
        for broken in [listing.replace('BootOrder: 0004,0001','BootOrder: 0001,0004'),listing.replace('Awai Otehon','Ubuntu'),listing.replace(GUID,'aaaaaaaa-1234-5678-9abc-0123456789ab'),listing.replace(b.LOADER,r'\EFI\other.efi'),listing.replace('Boot0004*','Boot0004 ')]:
            with self.subTest(broken=broken),self.assertRaises(b.Refused):b.verified_entry(broken,GUID)
    def test_legacy_and_readonly_efi_refused(self):
        with tempfile.TemporaryDirectory() as directory:
            p=Path(directory)/'missing'
            with patch.object(b,'EFI',p),self.assertRaisesRegex(b.Refused,'uefi-mode'):b.check_uefi()
            p.mkdir()
            for output in ['efivarfs ro,nosuid\n','ext4 rw\n']:
                with patch.object(b,'EFI',p),patch.object(b.subprocess,'run',return_value=SimpleNamespace(stdout=output)),self.assertRaises(b.Refused):b.check_uefi()
    def test_regular_file_never_registers_firmware(self):
        with tempfile.TemporaryFile() as f,patch.object(b,'check_uefi'),patch.object(b.subprocess,'run') as run:
            with self.assertRaises(b.Refused):b.register(f.fileno())
            run.assert_not_called()

if __name__=='__main__':unittest.main()
