"""
Example Python inference client for LAN Camera Streaming.

Demonstrates two easy ways to capture the camera feed directly in Python:
1. Streaming with OpenCV (cv2.VideoCapture) - Recommended for real-time video/YOLO/object detection.
2. Fetching single frames with requests/urllib - Useful for polling / periodic inference.

Requirements:
    pip install opencv-python
"""

import sys
import cv2

# Replace with your actual server host, room ID, and access PIN
STREAM_URL = "http://localhost:3000/stream/room-abc123?pin=123456"

def run_opencv_stream(url=STREAM_URL):
    print(f"Connecting to camera stream: {url}")
    cap = cv2.VideoCapture(url)

    if not cap.isOpened():
        print("Error: Could not open video stream. Check if sender is streaming and PIN is correct.")
        sys.exit(1)

    print("Stream opened successfully! Press 'q' in the window to quit.")

    while True:
        ret, frame = cap.read()
        if not ret:
            print("Warning: Dropped or empty frame, waiting...")
            cv2.waitKey(100)
            continue

        # -------------------------------------------------------------
        # INFERENCE CODE HERE:
        # e.g.:
        # results = model(frame)
        # annotated_frame = results[0].plot()
        # -------------------------------------------------------------

        # Display the live frame
        cv2.imshow("LAN Camera Stream - Python Inference", frame)

        if cv2.waitKey(1) & 0xFF == ord('q'):
            break

    cap.release()
    cv2.destroyAllWindows()
    print("Stream closed.")

if __name__ == "__main__":
    url = sys.argv[1] if len(sys.argv) > 1 else STREAM_URL
    run_opencv_stream(url)
