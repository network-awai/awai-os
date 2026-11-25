#!/usr/bin/env python3
"""Detached worker for tests: the production worker with the test device directory (regular files)."""
import sys
sys.path.insert(0, __import__("os").path.dirname(__import__("os").path.abspath(__file__)))
import fakes  # noqa: E402
import core  # noqa: E402

sys.exit(core.worker_main(sys.argv[2:], host=fakes.FakeHost(sys.argv[1])))
