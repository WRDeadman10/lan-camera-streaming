"""
Main CLI entry point for running Python inference with interchangeable transports.

Supports:
- Transport 1: --transport mjpeg (HTTP MJPEG stream)
- Transport 2: --transport webrtc (P2P WebRTC via aiortc)

Usage:
    python run_inference.py --transport mjpeg --url http://localhost:3000/stream/room-123?pin=123456
    python run_inference.py --transport webrtc --url http://localhost:3000 --room room-123 --pin 123456
"""

import argparse
import sys
import time
import cv2
import numpy as np

from python_inference.pipeline import InferencePipeline
from python_inference.transports.mjpeg_transport import MjpegVideoTransport
from python_inference.transports.webrtc_transport import WebRtcVideoTransport


def dummy_detector(frame: np.ndarray):
    """
    Simulated inference model (e.g. YOLO/PyTorch object detector).
    Draws a simulated detection box and confidence score.
    """
    h, w = frame.shape[:2]
    # Simulate a lightweight 5ms processing step
    time.sleep(0.005)
    # Return bounding box
    return [{"label": "target", "box": (int(w * 0.25), int(h * 0.25), int(w * 0.75), int(h * 0.75)), "score": 0.94}]


def main():
    parser = argparse.ArgumentParser(description="LAN Camera Streaming - Unified Python Inference Client")
    parser.add_argument("--transport", choices=["mjpeg", "webrtc"], default="mjpeg", help="Transport adapter to use")
    parser.add_argument("--url", default="http://localhost:3000", help="Server base URL or full MJPEG stream URL")
    parser.add_argument("--room", default="room-default", help="Room ID (for webrtc)")
    parser.add_argument("--pin", default="123456", help="Access PIN")
    parser.add_argument("--no-gui", action="store_true", help="Run without cv2.imshow GUI (headless mode)")
    parser.add_argument("--max-age", type=float, default=250.0, help="Max frame age in ms before dropping stale frames")
    args = parser.parse_args()

    print(f"\n=======================================================")
    print(f" Starting Python Vision Inference Pipeline")
    print(f" Transport: {args.transport.upper()}")
    print(f" Server URL: {args.url}")
    print(f" Policy: Fresh frames prioritized (drop queue > 1, max age {args.max_age}ms)")
    print(f"=======================================================\n")

    if args.transport == "mjpeg":
        # Check if full stream URL was given or needs construction
        stream_url = args.url
        if "/stream/" not in stream_url:
            stream_url = f"{args.url.rstrip('/')}/stream/{args.room}?pin={args.pin}"
        transport = MjpegVideoTransport(stream_url=stream_url)
    else:
        transport = WebRtcVideoTransport(signaling_url=args.url, room_id=args.room, access_pin=args.pin)

    pipeline = InferencePipeline(transport=transport, model_fn=dummy_detector, max_frame_age_ms=args.max_age)

    if not pipeline.start():
        print("Failed to start video transport.")
        sys.exit(1)

    print("Transport started. Waiting for incoming camera frames (Press 'q' in window or Ctrl+C in terminal to exit)...")

    last_log_time = time.time()

    try:
        while True:
            output = pipeline.process_next_frame(timeout_s=1.0)
            if output is None:
                # No frame yet or transport waiting
                continue

            frame = output["frame"]
            metrics = output["metrics"]
            dropped = output["dropped"]

            now = time.time()
            if now - last_log_time >= 3.0:
                last_log_time = now
                print(
                    f"[{metrics.get('transport', args.transport)}] "
                    f"FPS: {metrics.get('fps', 0)} | "
                    f"Inf FPS: {metrics.get('inference_fps', 0)} | "
                    f"Latency: {metrics.get('avg_inference_latency_ms', 0)}ms | "
                    f"Frame Age: {metrics.get('frame_age_ms', 0)}ms | "
                    f"Dropped: {metrics.get('frames_dropped', 0)} | "
                    f"CPU: {metrics.get('cpu_percent', 0)}% | "
                    f"RAM: {metrics.get('memory_mb', 0)}MB | "
                    f"Bandwidth: {metrics.get('data_rate_kbps', 0)} kbps"
                )

            if not args.no_gui and not dropped:
                # Render HUD onto display frame
                display_frame = frame.copy()
                hud_text = f"FPS: {metrics.get('fps', 0)} | Latency: {metrics.get('frame_age_ms', 0)}ms | CPU: {metrics.get('cpu_percent', 0)}%"
                cv2.putText(display_frame, hud_text, (20, 35), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)

                # Render detection boxes if present
                if output.get("result"):
                    for det in output["result"]:
                        x1, y1, x2, y2 = det["box"]
                        cv2.rectangle(display_frame, (x1, y1), (x2, y2), (0, 255, 255), 2)
                        cv2.putText(display_frame, f"{det['label']} {det['score']:.2f}", (x1, y1 - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 255), 2)

                cv2.imshow("LAN Camera Streaming - Python Inference", display_frame)
                if cv2.waitKey(1) & 0xFF == ord('q'):
                    break

    except KeyboardInterrupt:
        print("\nStopping inference pipeline...")
    finally:
        pipeline.stop()
        if not args.no_gui:
            cv2.destroyAllWindows()
        print("Pipeline stopped.")


if __name__ == "__main__":
    main()
