package stud.mavino.net;

import android.content.Intent;
import android.net.Uri;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;

/**
 * Local Capacitor plugin that downloads an APK from a URL and launches the
 * Android system package installer to perform an in-app self-update.
 *
 * The APK is streamed to <external-files-dir>/updates/mavino.apk and shared
 * with the installer via a FileProvider (authority "${applicationId}.fileprovider",
 * configured in AndroidManifest.xml + res/xml/file_paths.xml).
 *
 * Resolves the JS call once the installer intent has been launched — the
 * actual install confirmation happens in Android's system UI.
 */
@CapacitorPlugin(name = "ApkUpdater")
public class ApkUpdaterPlugin extends Plugin {

    private static final String UPDATES_DIR = "updates";
    private static final String APK_NAME = "mavino.apk";

    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        String url = call.getString("url");
        String expectedSha256 = call.getString("sha256"); // optional, hex-encoded
        if (url == null || url.isEmpty()) {
            call.reject("url is required");
            return;
        }

        // Run off the main thread — downloads + hashing can take a while.
        getBridge().execute(() -> {
            HttpURLConnection conn = null;
            try {
                File updatesDir = new File(getContext().getExternalFilesDir(null), UPDATES_DIR);
                if (!updatesDir.exists() && !updatesDir.mkdirs()) {
                    call.reject("Failed to create updates directory");
                    return;
                }
                File apkFile = new File(updatesDir, APK_NAME);
                // Delete any previous staged APK so we don't install a stale one.
                if (apkFile.exists()) {
                    //noinspection ResultOfMethodCallIgnored
                    apkFile.delete();
                }

                conn = (HttpURLConnection) new URL(url).openConnection();
                conn.setConnectTimeout(30_000);
                conn.setReadTimeout(60_000);
                conn.setInstanceFollowRedirects(true);
                conn.connect();
                int code = conn.getResponseCode();
                if (code < 200 || code >= 300) {
                    call.reject("HTTP " + code + " fetching APK");
                    return;
                }

                MessageDigest sha256 = MessageDigest.getInstance("SHA-256");
                try (InputStream in = conn.getInputStream();
                     FileOutputStream out = new FileOutputStream(apkFile)) {
                    byte[] buf = new byte[64 * 1024];
                    int n;
                    while ((n = in.read(buf)) != -1) {
                        out.write(buf, 0, n);
                        sha256.update(buf, 0, n);
                    }
                }

                // Verify checksum if provided.
                if (expectedSha256 != null && !expectedSha256.isEmpty()) {
                    String actual = bytesToHex(sha256.digest());
                    if (!expectedSha256.toLowerCase().equals(actual.toLowerCase())) {
                        //noinspection ResultOfMethodCallIgnored
                        apkFile.delete();
                        call.reject("SHA256 mismatch: expected " + expectedSha256 + ", got " + actual);
                        return;
                    }
                }

                // Launch the system package installer via FileProvider.
                Uri uri = FileProvider.getUriForFile(
                        getContext(),
                        getContext().getPackageName() + ".fileprovider",
                        apkFile
                );
                Intent intent = new Intent(Intent.ACTION_VIEW);
                intent.setDataAndType(uri, "application/vnd.android.package-archive");
                intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);
                getContext().startActivity(intent);

                JSObject ret = new JSObject();
                ret.put("launched", true);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("Update failed: " + e.getMessage());
            } finally {
                if (conn != null) conn.disconnect();
            }
        });
    }

    private static String bytesToHex(byte[] bytes) {
        StringBuilder sb = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) sb.append(String.format("%02x", b & 0xff));
        return sb.toString();
    }
}
