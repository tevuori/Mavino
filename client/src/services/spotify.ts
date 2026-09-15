import { api } from "./api";

// ===== Spotify Web API types (subset) =====

export interface SpotifyImage {
  url: string;
  width: number | null;
  height: number | null;
}

export interface SpotifyArtist {
  id: string;
  name: string;
  uri: string;
}

export interface SpotifyAlbum {
  id: string;
  name: string;
  images: SpotifyImage[];
  uri: string;
}

export interface SpotifyTrack {
  id: string;
  name: string;
  uri: string;
  duration_ms: number;
  artists: SpotifyArtist[];
  album: SpotifyAlbum;
}

export interface SpotifyDevice {
  id: string;
  name: string;
  type: string;
  is_active: boolean;
  volume_percent: number | null;
}

export interface SpotifyPlayerState {
  device: SpotifyDevice | null;
  is_playing: boolean;
  item: SpotifyTrack | null;
  progress_ms: number | null;
  repeat_state: "off" | "track" | "context";
  shuffle_state: boolean;
  timestamp: number;
  repeat_mode?: number;
}

// ===== API proxy calls (server holds token) =====

export interface SpotifyCredentialStatus {
  hasCredentials: boolean;
  configured: boolean;
}

export const spotifyApi = {
  // ---------- Credential management (per-user) ----------
  getCredentials: () => api.get<SpotifyCredentialStatus>("/api/spotify/credentials"),
  setCredentials: (clientId: string, clientSecret: string, refreshToken: string) =>
    api.put<{ ok: boolean }>("/api/spotify/credentials", { clientId, clientSecret, refreshToken }),
  deleteCredentials: () => api.delete<{ ok: boolean }>("/api/spotify/credentials"),

  // ---------- Spotify Web API ----------
  status: () => api.get<{ configured: boolean }>("/api/spotify/status"),
  token: () => api.get<{ access_token: string }>("/api/spotify/token"),
  me: () => api.get<{ id: string; display_name: string; product: string }>("/api/spotify/me"),
  player: () => api.get<SpotifyPlayerState>("/api/spotify/player"),
  current: () => api.get<{ is_playing: boolean; item: SpotifyTrack | null }>("/api/spotify/current"),
  devices: () => api.get<{ devices: SpotifyDevice[] }>("/api/spotify/devices"),
  play: (body?: { device_id?: string; uris?: string[]; context_uri?: string; position_ms?: number }) =>
    api.put<{ ok: boolean }>("/api/spotify/play", body),
  pause: (deviceId?: string) => api.put<{ ok: boolean }>("/api/spotify/pause", { device_id: deviceId }),
  next: (deviceId?: string) => api.post<{ ok: boolean }>("/api/spotify/next", { device_id: deviceId }),
  previous: (deviceId?: string) => api.post<{ ok: boolean }>("/api/spotify/previous", { device_id: deviceId }),
  seek: (positionMs: number, deviceId?: string) =>
    api.put<{ ok: boolean }>(`/api/spotify/seek?position_ms=${positionMs}${deviceId ? `&device_id=${deviceId}` : ""}`),
  volume: (percent: number, deviceId?: string) =>
    api.put<{ ok: boolean }>(`/api/spotify/volume?volume_percent=${percent}${deviceId ? `&device_id=${deviceId}` : ""}`),
  shuffle: (state: boolean, deviceId?: string) =>
    api.put<{ ok: boolean }>(`/api/spotify/shuffle?state=${state}${deviceId ? `&device_id=${deviceId}` : ""}`),
  repeat: (state: "off" | "track" | "context", deviceId?: string) =>
    api.put<{ ok: boolean }>(`/api/spotify/repeat?state=${state}${deviceId ? `&device_id=${deviceId}` : ""}`),
  transfer: (deviceIds: string[], play = true) =>
    api.put<{ ok: boolean }>("/api/spotify/transfer", { device_ids: deviceIds, play }),
};

// ===== Web Playback SDK loader =====

declare global {
  interface Window {
    onSpotifyWebPlaybackSDKReady: () => void;
    Spotify: SpotifySDKNamespace;
  }
}

export interface SpotifyPlayer {
  connect: () => Promise<boolean>;
  disconnect: () => void;
  addListener: (event: string, cb: (...args: unknown[]) => void) => void;
  getCurrentState: () => Promise<WebPlaybackState | null>;
  setName: (name: string) => Promise<void>;
  getVolume: () => Promise<number>;
  setVolume: (v: number) => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  togglePlay: () => Promise<void>;
  seek: (ms: number) => Promise<void>;
  previousTrack: () => Promise<void>;
  nextTrack: () => Promise<void>;
  activateElement: () => Promise<void>;
}

export interface SpotifySDKConstructor {
  new (config: {
    name: string;
    getOAuthToken: (cb: (token: string) => void) => void;
    volume?: number;
    enableMediaSession?: boolean;
  }): SpotifyPlayer;
}

// The Spotify Web Playback SDK exposes `window.Spotify` as a namespace object;
// the actual player constructor lives at `window.Spotify.Player`.
export interface SpotifySDKNamespace {
  Player: SpotifySDKConstructor;
}

export interface WebPlaybackState {
  context: { uri: string | null; metadata: unknown };
  disallows: Record<string, boolean>;
  paused: boolean;
  position: number;
  duration: number;
  repeat_mode: number;
  shuffle: boolean;
  track_window: {
    current_track: {
      id: string;
      uri: string;
      name: string;
      duration_ms: number;
      artists: { uri: string; name: string }[];
      album: { uri: string; name: string; images: SpotifyImage[] };
    };
    previous_tracks: unknown[];
    next_tracks: unknown[];
  };
}

let sdkPromise: Promise<SpotifySDKNamespace> | null = null;

export function loadSpotifySDK(): Promise<SpotifySDKNamespace> {
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise((resolve) => {
    if (window.Spotify?.Player) {
      resolve(window.Spotify);
      return;
    }
    window.onSpotifyWebPlaybackSDKReady = () => resolve(window.Spotify);
    const script = document.createElement("script");
    script.src = "https://sdk.scdn.co/spotify-player.js";
    script.async = true;
    document.body.appendChild(script);
  });
  return sdkPromise;
}
