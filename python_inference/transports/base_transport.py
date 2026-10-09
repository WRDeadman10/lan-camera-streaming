"""
Base video transport interface for Python inference client.
Defines common contract for reading frames, getting telemetry stats, and clean resource teardown.
"""

from abc import ABC, abstractmethod
from typing import Optional, Tuple, Dict, Any
import numpy as np


class VideoFrame:
    """Encapsulates a video frame with timing and sequencing metadata."""
    def __init__(self, data: np.ndarray, timestamp_ms: float, frame_id: int):
        self.data: np.ndarray = data  # OpenCV BGR format ndarray
        self.timestamp_ms: float = timestamp_ms
        self.frame_id: int = frame_id

    @property
    def shape(self) -> Tuple[int, int, int]:
        return self.data.shape

    @property
    def width(self) -> int:
        return self.data.shape[1]

    @property
    def height(self) -> int:
        return self.data.shape[0]


class BaseVideoTransport(ABC):
    """Abstract base class for inference video transports (MJPEG, WebRTC, etc.)."""

    @abstractmethod
    def start(self) -> bool:
        """Initialize connection and start receiving frames."""
        pass

    @abstractmethod
    def read_frame(self, timeout_s: float = 1.0) -> Optional[VideoFrame]:
        """
        Read the freshest available frame.
        Drops older buffered frames if inference was slower than stream.
        Returns None if no frame is available within timeout or if transport stopped.
        """
        pass

    @abstractmethod
    def get_stats(self) -> Dict[str, Any]:
        """Return real-time transport stats (FPS, dropped frames, RTT, candidate pairs, etc.)."""
        pass

    @abstractmethod
    def stop(self) -> None:
        """Disconnect and release all resources."""
        pass
