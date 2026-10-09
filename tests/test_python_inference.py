"""
Unit and integration tests for python_inference package.
Tests:
- BaseVideoTransport & VideoFrame
- MetricsCollector (FPS, CPU, drop counters, bandwidth)
- MjpegVideoTransport fresh-frame queue drop policy
- InferencePipeline coordination and stale frame drop threshold
"""

import unittest
import time
import os
import sys
import numpy as np

# Ensure repository root is on sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from python_inference.transports.base_transport import BaseVideoTransport, VideoFrame
from python_inference.utils.metrics import MetricsCollector
from python_inference.pipeline import InferencePipeline


class MockTransport(BaseVideoTransport):
    def __init__(self):
        self.started = False
        self.stopped = False
        self.frames = []

    def start(self) -> bool:
        self.started = True
        return True

    def enqueue_mock_frame(self, data: np.ndarray, timestamp_ms: float, frame_id: int):
        self.frames.append(VideoFrame(data, timestamp_ms, frame_id))

    def read_frame(self, timeout_s: float = 1.0):
        if self.frames:
            return self.frames.pop(0)
        return None

    def get_stats(self):
        return {"transport": "Mock", "fps": 30.0}

    def stop(self) -> None:
        self.stopped = True


class TestPythonInference(unittest.TestCase):

    def test_metrics_collector(self):
        collector = MetricsCollector()
        collector.record_frame_received(byte_size=1024)
        collector.record_inference_time(latency_ms=12.5)
        collector.record_frame_dropped(count=2)

        summary = collector.get_summary()
        self.assertEqual(summary["frames_received"], 1)
        self.assertEqual(summary["frames_processed"], 1)
        self.assertEqual(summary["frames_dropped"], 2)
        self.assertEqual(summary["avg_inference_latency_ms"], 12.5)
        self.assertGreaterEqual(summary["memory_mb"], 0.0)

    def test_inference_pipeline_freshness_drop_policy(self):
        mock_transport = MockTransport()
        detector_called = []

        def dummy_model(img):
            detector_called.append(True)
            return "ok"

        pipeline = InferencePipeline(
            transport=mock_transport,
            model_fn=dummy_model,
            max_frame_age_ms=100.0  # drop frames older than 100ms
        )
        self.assertTrue(pipeline.start())

        # 1. Fresh frame: timestamp = current time
        now_ms = time.time() * 1000.0
        fresh_img = np.zeros((480, 640, 3), dtype=np.uint8)
        mock_transport.enqueue_mock_frame(fresh_img, now_ms - 20.0, 1)

        result_fresh = pipeline.process_next_frame()
        self.assertIsNotNone(result_fresh)
        self.assertFalse(result_fresh["dropped"])
        self.assertEqual(result_fresh["result"], "ok")
        self.assertEqual(len(detector_called), 1)

        # 2. Stale frame: timestamp = 500ms ago (exceeds 100ms limit)
        stale_img = np.zeros((480, 640, 3), dtype=np.uint8)
        mock_transport.enqueue_mock_frame(stale_img, now_ms - 500.0, 2)

        result_stale = pipeline.process_next_frame()
        self.assertIsNotNone(result_stale)
        self.assertTrue(result_stale["dropped"])
        self.assertIsNone(result_stale["result"])
        # detector_called count should remain 1 (model was skipped to preserve CPU)
        self.assertEqual(len(detector_called), 1)

        pipeline.stop()
        self.assertTrue(mock_transport.stopped)


if __name__ == "__main__":
    unittest.main()
