# LAN Camera Receiver (Unity Package)

A high-performance Unity package for streaming low-latency video feeds directly from phone cameras or LAN Camera Streaming instances into Unity scenes.

## Features

- **Direct Texture Streaming**: Decodes incoming JPEG/MJPEG frames directly into reusable `Texture2D` instances without garbage collection spikes.
- **Multiple Targets**: Automatically binds to `RawImage` (UI) or `Renderer` materials (3D meshes, monitor screens).
- **Zero External Dependencies**: Pure C# using Unity's built-in `ImageConversion.LoadImage` and `System.Net.Http`.
- **Strict Architecture**: Adheres strictly to production Unity standards (composition, explicit typing, K&R bracing, thread safety).

## Installation

Add this package to your Unity project's `Packages/manifest.json`:

```json
{
  "dependencies": {
    "com.vcam.lancamera": "file:../../lan-camera-streaming/unity-package"
  }
}
```

Or via Package Manager: **Add package from disk...** and select `unity-package/package.json`.

## Usage

1. Add `LanCameraReceiver` component to any GameObject in your scene.
2. In the Inspector, configure:
   - **Host**: Server IP address (e.g. `127.0.0.1` or LAN IP `192.168.1.X`).
   - **Port**: Server port (default `3000` or `7777`).
   - **Room ID**: Active streaming room ID.
   - **Access PIN**: Room access PIN.
3. Assign either:
   - A `RawImage` in the UI to **Target Raw Image**.
   - A `MeshRenderer` to **Target Renderer**.
4. Press Play!
