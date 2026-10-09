"""
MJPEG HTTP Video Transport.
Reads multipart/x-mixed-replace JPEG frames from the Node.js server endpoint.
Uses a background worker thread with a single-item queue (or bounded queue)
to discard stale frames and guarantee that inference receives the freshest frame.
"""

import threading
import queue
import time
import urllib.request
from typing import Optional, Dict, Any
import numpy as np
import cv2

from .base_transport import BaseVideoTransport, VideoFrame


class MjpegVideoTransport(BaseVideoTransport):
    """
    HTTP MJPEG streaming transport for Python OpenCV/inference.
    Connects to http://<host>:3000/stream/<roomId>?pin=<accessPin>.
    """

    def __init__(self, stream_url: str):
        self.stream_url = stream_url
        self._running = False
        self._thread: Optional[threading.Thread] = None
        self._frame_queue: queue.Queue = queue.Queue(maxsize=1)
        self._frame_id = 0
        self._dropped_frames = 0
        self._total_frames = 0
        self._total_bytes = 0
        self._fps = 0.0
        self._recent_timestamps = []
        self._lock = threading.Lock()

    def start(self) -> bool:
        """Start background capture thread."""
        if self._running:
            return True

        self._running = True
        self._thread = threading.Thread(target=self._capture_loop, name="MjpegCaptureWorker", daemon=True)
        self._thread.start()
        return True

    def read_frame(self, timeout_s: float = 1.0) -> Optional[VideoFrame]:
        """Fetch the latest available frame, dropping stale queue entries."""
        try:
            return self._frame_queue.get(timeout=timeout_s)
        except queue.Empty:
            return None

    def _capture_loop(self) -> None:
        """Background thread reading JPEG multipart chunks."""
        # Open URL with streaming chunk reader
        while self._running:
            try:
                req = urllib.request.Request(self.stream_url, headers={"User-Agent": "Python-Inference/1.0"})
                with urllib.request.urlopen(req, timeout=10.0) as stream:
                    buffer = bytearray()
                    while self._running:
                        chunk = stream.read(8192)
                        if not chunk:
                            break

                        self._total_bytes += len(chunk)
                        buffer.extend(chunk)

                        # Look for JPEG start (0xFFD8) and end (0xFFD9) markers
                        start = buffer.find(b'\xff\xd8')
                        end = buffer.find(b'\xff\xd9')

                        if start != -1 and end != -1 and end > start:
                            jpeg_bytes = buffer[start:end + 2]
                            buffer = buffer[end + 2:]

                            now_ms = time.time() * 1000.0
                            self._total_frames += 1

                            # Update FPS calculation
                            self._update_fps()

                            # Decode JPEG to BGR numpy array
                            nparr = np.frombuffer(jpeg_bytes, dtype=np.uint8)
                            img_bgr = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

                            if img_bgr is not None:
                                self._frame_id += 1
                                frame = VideoFrame(img_bgr, now_ms, self._frame_id)

                                # Fresh-frame queue management: drop old frame if inference hasn't consumed it
                                if self._frame_queue.full():
                                    try:
                                        self._frame_queue.get_nowait()
                                        with self._lock:
                                            self._dropped_frames += 1
                                    except queue.Empty:
                                        pass

                                self._frame_queue.put(frame)

            except Exception as e:
                if not self._running:
                    break
                # Retry connection after brief backoff
                time.sleep(1.0)

    def _update_fps(self) -> None:
        now = time.time()
        self._recent_timestamps.append(now)
        if len(self._recent_timestamps) > 30:
            self._recent_timestamps.pop(0)
        if len(self._recent_timestamps) > 1:
            duration = self._recent_timestamps[-1] - self._recent_timestamps[0]
            if duration > 0:
                self._fps = (len(self._recent_timestamps) - 1) / duration

    def get_stats(self) -> Dict[str, Any]:
        """Return transport statistics."""
        with self._lock:
            dropped = self._dropped_frames
        return {
            "transport": "MJPEG-HTTP",
            "fps": round(self._fps, 1),
            "total_frames": self._total_frames,
            "dropped_frames": dropped,
            "total_bytes": self._total_bytes,
            "connected": self._running
        }

    def stop(self) -> None:
        """Stop capture worker and drain queue."""
        self._running = False
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=1.0)
            self._thread = None
        # Drain queue
        while not self._frame_queue.empty():
            try:
                self._frame_queue.get_nowait()
            except queue.Empty:
                break
