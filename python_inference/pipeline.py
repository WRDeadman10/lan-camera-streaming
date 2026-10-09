"""
Unified Python Inference Pipeline.
Provides a transport-agnostic pipeline for OpenCV, YOLO, and PyTorch models.
Enforces fresh-frame processing, drops stale frames, and logs comprehensive telemetry.
"""

import time
from typing import Optional, Callable, Dict, Any
import numpy as np
import cv2

from .transports.base_transport import BaseVideoTransport, VideoFrame
from .utils.metrics import MetricsCollector


class InferencePipeline:
    """
    Transport-agnostic vision inference pipeline.
    Accepts any BaseVideoTransport (MJPEG, WebRTC, etc.) and processes frames with full telemetry.
    """

    def __init__(
        self,
        transport: BaseVideoTransport,
        model_fn: Optional[Callable[[np.ndarray], Any]] = None,
        max_frame_age_ms: float = 250.0
    ):
        self.transport = transport
        self.model_fn = model_fn
        self.max_frame_age_ms = max_frame_age_ms
        self.metrics = MetricsCollector()
        self._running = False

    def start(self) -> bool:
        """Start underlying transport."""
        self._running = True
        return self.transport.start()

    def process_next_frame(self, timeout_s: float = 1.0) -> Optional[Dict[str, Any]]:
        """
        Fetch fresh frame, check staleness, execute inference, and update metrics.
        Returns dictionary containing frame, inference result, and stats, or None.
        """
        if not self._running:
            return None

        frame: Optional[VideoFrame] = self.transport.read_frame(timeout_s=timeout_s)
        if frame is None:
            return None

        now_ms = time.time() * 1000.0
        frame_age_ms = now_ms - frame.timestamp_ms

        # Record received frame in metrics
        self.metrics.record_frame_received(byte_size=frame.data.nbytes)

        # Staleness drop check: if frame took longer than max_frame_age_ms to reach inference, skip
        if frame_age_ms > self.max_frame_age_ms:
            self.metrics.record_frame_dropped(1)
            return {
                "frame": frame.data,
                "dropped": True,
                "frame_age_ms": round(frame_age_ms, 1),
                "result": None,
                "metrics": self.metrics.get_summary()
            }

        # Run model inference function
        t0 = time.time()
        result = None
        if self.model_fn:
            result = self.model_fn(frame.data)
        inference_latency_ms = (time.time() - t0) * 1000.0

        self.metrics.record_inference_time(inference_latency_ms)

        summary = self.metrics.get_summary()
        summary.update(self.transport.get_stats())
        summary["frame_age_ms"] = round(frame_age_ms, 1)

        return {
            "frame": frame.data,
            "dropped": False,
            "frame_age_ms": round(frame_age_ms, 1),
            "result": result,
            "metrics": summary
        }

    def stop(self) -> None:
        """Stop transport and pipeline."""
        self._running = False
        self.transport.stop()
