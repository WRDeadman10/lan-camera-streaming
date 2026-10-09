"""
Metrics collector tracking FPS, latency/frame age, CPU/memory usage,
dropped frames, and estimated bandwidth consumption.
"""

import time
import os
import psutil
from typing import Dict, Any


class MetricsCollector:
    """Collects and reports real-time inference and transport telemetry."""

    def __init__(self, window_size: int = 30):
        self.window_size = window_size
        self.start_time = time.time()
        self.frames_received = 0
        self.frames_processed = 0
        self.frames_dropped = 0
        self.bytes_received = 0

        self.last_frame_time = time.time()
        self.fps = 0.0
        self.inference_fps = 0.0
        self.avg_inference_latency_ms = 0.0

        self.recent_frame_times = []
        self.recent_inference_times = []
        self.process = psutil.Process(os.getpid())

    def record_frame_received(self, byte_size: int = 0) -> None:
        """Call when a frame arrives at the transport layer."""
        now = time.time()
        self.frames_received += 1
        self.bytes_received += byte_size
        self.recent_frame_times.append(now)

        if len(self.recent_frame_times) > self.window_size:
            self.recent_frame_times.pop(0)

        if len(self.recent_frame_times) > 1:
            duration = self.recent_frame_times[-1] - self.recent_frame_times[0]
            if duration > 0:
                self.fps = (len(self.recent_frame_times) - 1) / duration

    def record_frame_dropped(self, count: int = 1) -> None:
        """Call when stale frames are discarded from queue to prioritize freshness."""
        self.frames_dropped += count

    def record_inference_time(self, latency_ms: float) -> None:
        """Call after completing inference on a frame."""
        now = time.time()
        self.frames_processed += 1
        self.recent_inference_times.append((now, latency_ms))

        if len(self.recent_inference_times) > self.window_size:
            self.recent_inference_times.pop(0)

        if self.recent_inference_times:
            latencies = [lat for _, lat in self.recent_inference_times]
            self.avg_inference_latency_ms = sum(latencies) / len(latencies)

        if len(self.recent_inference_times) > 1:
            duration = self.recent_inference_times[-1][0] - self.recent_inference_times[0][0]
            if duration > 0:
                self.inference_fps = (len(self.recent_inference_times) - 1) / duration

    def get_summary(self) -> Dict[str, Any]:
        """Return system and performance metrics snapshot."""
        try:
            cpu_percent = self.process.cpu_percent(interval=None)
            mem_info = self.process.memory_info()
            mem_mb = mem_info.rss / (1024 * 1024)
        except Exception:
            cpu_percent = 0.0
            mem_mb = 0.0

        elapsed = max(1.0, time.time() - self.start_time)
        kb_per_sec = (self.bytes_received / 1024) / elapsed

        return {
            "fps": round(self.fps, 1),
            "inference_fps": round(self.inference_fps, 1),
            "avg_inference_latency_ms": round(self.avg_inference_latency_ms, 1),
            "frames_received": self.frames_received,
            "frames_processed": self.frames_processed,
            "frames_dropped": self.frames_dropped,
            "cpu_percent": round(cpu_percent, 1),
            "memory_mb": round(mem_mb, 1),
            "data_rate_kbps": round(kb_per_sec * 8, 1),
            "total_mbytes": round(self.bytes_received / (1024 * 1024), 2)
        }
