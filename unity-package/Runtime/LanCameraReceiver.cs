using System;
using System.Collections.Concurrent;
using System.IO;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using UnityEngine;
using UnityEngine.UI;

namespace LanCamera {
    [AddComponentMenu("LanCamera/LAN Camera Receiver")]
    public class LanCameraReceiver : MonoBehaviour {
        [SerializeField] private LanCameraConfig config = new LanCameraConfig();
        [SerializeField] private bool autoConnectOnStart = true;
        [SerializeField] private RawImage targetRawImage;
        [SerializeField] private Renderer targetRenderer;
        [SerializeField] private string targetTextureProperty = "_MainTex";

        private Texture2D videoTexture;
        private LanCameraState currentState = LanCameraState.Disconnected;
        private CancellationTokenSource cancellationTokenSource;
        private Task streamTask;
        private readonly ConcurrentQueue<byte[]> frameQueue = new ConcurrentQueue<byte[]>();

        private int framesReceivedCount = 0;
        private float lastFpsCalculationTime = 0.0f;
        private float currentFps = 0.0f;

        public event Action<Texture2D> OnFrameReceived;
        public event Action<LanCameraState> OnStateChanged;
        public event Action<string> OnError;

        public Texture2D VideoTexture {
            get {
                return videoTexture;
            }
        }

        public LanCameraState CurrentState {
            get {
                return currentState;
            }
        }

        public float CurrentFps {
            get {
                return currentFps;
            }
        }

        public LanCameraConfig Config {
            get {
                return config;
            }
            set {
                config = value;
            }
        }

        private void Start() {
            InitializeTexture();
            if (autoConnectOnStart) {
                StartStream();
            }
        }

        private void Update() {
            ProcessFrameQueue();
            UpdateFpsCounter();
        }

        private void OnDestroy() {
            StopStream();
            if (videoTexture != null) {
                Destroy(videoTexture);
                videoTexture = null;
            }
        }

        private void OnDisable() {
            StopStream();
        }

        public void StartStream() {
            if (currentState == LanCameraState.Streaming || currentState == LanCameraState.Connecting) {
                return;
            }

            SetState(LanCameraState.Connecting);
            cancellationTokenSource = new CancellationTokenSource();
            CancellationToken token = cancellationTokenSource.Token;

            streamTask = Task.Run(async () => {
                await StreamLoopAsync(token);
            }, token);
        }

        public void StopStream() {
            if (cancellationTokenSource != null) {
                cancellationTokenSource.Cancel();
                cancellationTokenSource.Dispose();
                cancellationTokenSource = null;
            }

            while (frameQueue.TryDequeue(out byte[] _)) {
                // Drain queue
            }

            SetState(LanCameraState.Disconnected);
        }

        private void InitializeTexture() {
            if (videoTexture == null) {
                videoTexture = new Texture2D(1280, 720, TextureFormat.RGB24, false);
                ApplyTextureToTargets();
            }
        }

        private void ApplyTextureToTargets() {
            if (targetRawImage != null) {
                targetRawImage.texture = videoTexture;
            }

            if (targetRenderer != null) {
                targetRenderer.material.SetTexture(targetTextureProperty, videoTexture);
            }
        }

        private void SetState(LanCameraState newState) {
            if (currentState != newState) {
                currentState = newState;
                if (OnStateChanged != null) {
                    OnStateChanged.Invoke(currentState);
                }
            }
        }

        private void ProcessFrameQueue() {
            byte[] latestFrame = null;
            while (frameQueue.TryDequeue(out byte[] frame)) {
                latestFrame = frame;
            }

            if (latestFrame != null && latestFrame.Length > 0) {
                if (videoTexture == null) {
                    InitializeTexture();
                }

                bool loaded = ImageConversion.LoadImage(videoTexture, latestFrame, false);
                if (loaded) {
                    framesReceivedCount = framesReceivedCount + 1;
                    if (currentState != LanCameraState.Streaming) {
                        SetState(LanCameraState.Streaming);
                    }

                    if (OnFrameReceived != null) {
                        OnFrameReceived.Invoke(videoTexture);
                    }
                }
            }
        }

        private void UpdateFpsCounter() {
            float currentTime = Time.realtimeSinceStartup;
            float timeDifference = currentTime - lastFpsCalculationTime;
            if (timeDifference >= 1.0f) {
                currentFps = (float)framesReceivedCount / timeDifference;
                framesReceivedCount = 0;
                lastFpsCalculationTime = currentTime;
            }
        }

        private async Task StreamLoopAsync(CancellationToken token) {
            string streamUrl = config.BuildStreamUrl();

            using (HttpClient httpClient = new HttpClient()) {
                httpClient.Timeout = TimeSpan.FromSeconds(config.TimeoutSeconds);

                while (!token.IsCancellationRequested) {
                    try {
                        HttpRequestMessage request = new HttpRequestMessage(HttpMethod.Get, streamUrl);
                        using (HttpResponseMessage response = await httpClient.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, token)) {
                            if (!response.IsSuccessStatusCode) {
                                HandleNetworkError(string.Format("HTTP request failed with status code: {0}", response.StatusCode));
                                await Task.Delay(2000, token);
                                continue;
                            }

                            using (Stream stream = await response.Content.ReadAsStreamAsync()) {
                                await ReadMultipartStreamAsync(stream, token);
                            }
                        }
                    } catch (OperationCanceledException) {
                        break;
                    } catch (Exception ex) {
                        HandleNetworkError(ex.Message);
                        try {
                            await Task.Delay(2000, token);
                        } catch (OperationCanceledException) {
                            break;
                        }
                    }
                }
            }
        }

        private async Task ReadMultipartStreamAsync(Stream stream, CancellationToken token) {
            byte[] buffer = new byte[65536];
            MemoryStream frameBuffer = new MemoryStream();
            bool insideFrame = false;

            while (!token.IsCancellationRequested) {
                int bytesRead = await stream.ReadAsync(buffer, 0, buffer.Length, token);
                if (bytesRead == 0) {
                    break;
                }

                for (int i = 0; i < bytesRead; i = i + 1) {
                    byte currentByte = buffer[i];

                    if (!insideFrame) {
                        if (i + 1 < bytesRead && currentByte == 0xFF && buffer[i + 1] == 0xD8) {
                            insideFrame = true;
                            frameBuffer.SetLength(0);
                            frameBuffer.WriteByte(0xFF);
                            frameBuffer.WriteByte(0xD8);
                            i = i + 1;
                        }
                    } else {
                        frameBuffer.WriteByte(currentByte);
                        if (currentByte == 0xD9 && frameBuffer.Length > 2) {
                            long position = frameBuffer.Position;
                            frameBuffer.Position = position - 2;
                            int previousByte = frameBuffer.ReadByte();
                            frameBuffer.Position = position;

                            if (previousByte == 0xFF) {
                                byte[] completedFrame = frameBuffer.ToArray();
                                frameQueue.Enqueue(completedFrame);
                                insideFrame = false;
                            }
                        }
                    }
                }
            }
        }

        private void HandleNetworkError(string errorMessage) {
            Debug.LogWarning(string.Format("[LanCamera] Receiver error: {0}", errorMessage));
            if (OnError != null) {
                OnError.Invoke(errorMessage);
            }
            SetState(LanCameraState.Error);
        }
    }
}
