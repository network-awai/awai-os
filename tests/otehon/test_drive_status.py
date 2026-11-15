import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('drive_status', Path(__file__).parents[2] / 'nixos/otehon/drive/status.py')
s = importlib.util.module_from_spec(spec)
spec.loader.exec_module(s)


class Status(unittest.TestCase):
    def test_missing_or_malformed_counters_stay_unknown(self):
        for stats in [None, {}, {'diskCache': {}}, {'diskCache': {'uploadsQueued': False}}]:
            result = s.summarize(stats, True)
            self.assertEqual(result['localState'], 'unavailable')
            self.assertIsNone(result['uploadsQueued'])

    def test_pending_error_and_idle_do_not_grant_backend_or_distributed_receipts(self):
        cache = {'uploadsQueued': 0, 'uploadsInProgress': 0, 'erroredFiles': 0, 'outOfSpace': False}
        for field, value, phase in [('uploadsQueued', 1, 'pending'), ('uploadsInProgress', 2, 'pending'),
                                     ('erroredFiles', 1, 'error'), ('outOfSpace', True, 'error'),
                                     ('uploadsQueued', 0, 'transfer-idle')]:
            result = s.summarize({'diskCache': {**cache, field: value}, 'privatePath': '/private/owner'}, True)
            self.assertEqual(result['localState'], phase)
            self.assertFalse(result['backendReadbackVerified'])
            self.assertFalse(result['distributedPolicyMet'])
            self.assertNotIn('privatePath', result)
        self.assertEqual(s.summarize({'diskCache': cache}, False)['localState'], 'unavailable')
