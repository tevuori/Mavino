import { beforeEach, describe, expect, it, mock } from "bun:test";

let credential: { clientIdEnc: string; clientSecretEnc: string; refreshTokenEnc: string } | null = null;

mock.module("../db/client", () => ({
  default: {
    spotifyCredential: {
      findUnique: async () => credential,
      update: async () => credential,
    },
  },
}));

mock.module("./crypto", () => ({
  decryptSecret: (value: string) => {
    if (value === "invalid") throw new Error("Invalid ciphertext");
    return value.replace(/^enc:/, "");
  },
  encryptSecret: (value: string) => `enc:${value}`,
}));

const { getUserSpotifyConfig, isSpotifyConfiguredFor } = await import("./spotify");

describe("Spotify per-user configuration", () => {
  beforeEach(() => {
    credential = null;
    process.env.SPOTIFY_CLIENT_ID = "global-client";
    process.env.SPOTIFY_CLIENT_SECRET = "global-secret";
    process.env.SPOTIFY_REFRESH_TOKEN = "global-refresh";
  });

  it("does not use server environment credentials when the user has none", async () => {
    expect(await getUserSpotifyConfig("user-without-spotify")).toBeNull();
    expect(await isSpotifyConfiguredFor("user-without-spotify")).toBe(false);
  });

  it("returns complete personal credentials", async () => {
    credential = {
      clientIdEnc: "enc:personal-client",
      clientSecretEnc: "enc:personal-secret",
      refreshTokenEnc: "enc:personal-refresh",
    };

    expect(await getUserSpotifyConfig("configured-user")).toEqual({
      clientId: "personal-client",
      clientSecret: "personal-secret",
      refreshToken: "personal-refresh",
    });
    expect(await isSpotifyConfiguredFor("configured-user")).toBe(true);
  });

  it("rejects credentials that cannot be fully decrypted", async () => {
    credential = {
      clientIdEnc: "enc:personal-client",
      clientSecretEnc: "invalid",
      refreshTokenEnc: "enc:personal-refresh",
    };

    expect(await getUserSpotifyConfig("broken-user")).toBeNull();
    expect(await isSpotifyConfiguredFor("broken-user")).toBe(false);
  });
});
