using System;
using UnityEngine;

namespace LanCamera {
    [Serializable]
    public class LanCameraConfig {
        [SerializeField] private string host = "127.0.0.1";
        [SerializeField] private int port = 3000;
        [SerializeField] private string roomId = "default-room";
        [SerializeField] private string accessPin = "123456";
        [SerializeField] private bool useHttps = false;
        [SerializeField] private int timeoutSeconds = 10;

        public string Host {
            get {
                return host;
            }
            set {
                host = value;
            }
        }

        public int Port {
            get {
                return port;
            }
            set {
                port = value;
            }
        }

        public string RoomId {
            get {
                return roomId;
            }
            set {
                roomId = value;
            }
        }

        public string AccessPin {
            get {
                return accessPin;
            }
            set {
                accessPin = value;
            }
        }

        public bool UseHttps {
            get {
                return useHttps;
            }
            set {
                useHttps = value;
            }
        }

        public int TimeoutSeconds {
            get {
                return timeoutSeconds;
            }
            set {
                timeoutSeconds = value;
            }
        }

        public string BuildStreamUrl() {
            string scheme = useHttps ? "https" : "http";
            return string.Format("{0}://{1}:{2}/stream/{3}?pin={4}", scheme, host, port, roomId, accessPin);
        }

        public string BuildSnapshotUrl() {
            string scheme = useHttps ? "https" : "http";
            return string.Format("{0}://{1}:{2}/snapshot/{3}?pin={4}", scheme, host, port, roomId, accessPin);
        }
    }
}
