package ee.muhukaart.updater;

import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Arrays;
import java.util.concurrent.atomic.AtomicBoolean;

/** Downloads HTTPS bytes directly: never dispatches a GitHub app link. */
@CapacitorPlugin(name = "AppUpdater")
public class AppUpdaterPlugin extends Plugin {
    private final AtomicBoolean busy = new AtomicBoolean(false);

    @PluginMethod
    public void install(PluginCall call) {
        String url = call.getString("url", "");
        if (!url.matches("https://github\\.com/HamsterBuilds/Muhu-Kaart/releases/download/apk-[0-9]+/app-debug\\.apk")) {
            call.reject("Vigane uuenduse aadress");
            return;
        }
        if (!busy.compareAndSet(false, true)) {
            call.reject("Uuenduse allalaadimine juba käib");
            return;
        }
        new Thread(() -> {
            File apk = new File(getContext().getCacheDir(), "muhu-update.apk");
            try {
                URL next = new URL(url);
                HttpURLConnection connection = null;
                for (int redirect = 0; redirect <= 5; redirect++) {
                    String host = next.getHost();
                    if (!next.getProtocol().equals("https") || !(host.equals("github.com") || host.equals("release-assets.githubusercontent.com") || host.equals("objects.githubusercontent.com"))) {
                        throw new Exception("Uuenduse ümbersuunamine pole lubatud");
                    }
                    connection = (HttpURLConnection) next.openConnection();
                    connection.setInstanceFollowRedirects(false);
                    connection.setConnectTimeout(20000);
                    connection.setReadTimeout(30000);
                    connection.setRequestProperty("User-Agent", "Muhu-Kaart-Updater");
                    int status = connection.getResponseCode();
                    if (status >= 300 && status < 400) {
                        String location = connection.getHeaderField("Location");
                        connection.disconnect();
                        if (location == null || redirect == 5) throw new Exception("Liiga palju ümbersuunamisi");
                        next = new URL(next, location);
                        continue;
                    }
                    if (status != 200) { connection.disconnect(); throw new Exception("Allalaadimise HTTP viga " + status); }
                    break;
                }
                try {
                    long expected = connection.getContentLengthLong();
                    long total = 0;
                    long deadline = System.currentTimeMillis() + 300000;
                    try (InputStream input = connection.getInputStream(); FileOutputStream output = new FileOutputStream(apk)) {
                        byte[] buffer = new byte[65536];
                        int count;
                        while ((count = input.read(buffer)) != -1) {
                            total += count;
                            if (total > 200L * 1024 * 1024 || System.currentTimeMillis() > deadline) throw new Exception("Allalaadimine ületas limiidi; proovi uuesti");
                            output.write(buffer, 0, count);
                        }
                    }
                    if (total == 0 || (expected >= 0 && expected != total)) throw new Exception("APK allalaadimine jäi pooleli");
                } finally { connection.disconnect(); }
                PackageManager pm = getContext().getPackageManager();
                PackageInfo downloaded = pm.getPackageArchiveInfo(apk.getAbsolutePath(), PackageManager.GET_SIGNATURES);
                PackageInfo installed = pm.getPackageInfo(getContext().getPackageName(), PackageManager.GET_SIGNATURES);
                if (downloaded == null || !installed.packageName.equals(downloaded.packageName)
                    || installed.signatures == null || downloaded.signatures == null
                    || !Arrays.equals(installed.signatures, downloaded.signatures)
                    || downloaded.versionCode < installed.versionCode) {
                    throw new Exception("APK rakendus või allkiri ei vasta paigaldatud äpile");
                }
                getActivity().runOnUiThread(() -> {
                    try {
                        if (Build.VERSION.SDK_INT >= 26 && !pm.canRequestPackageInstalls()) {
                            getActivity().startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + installed.packageName)));
                        } else {
                            Uri uri = FileProvider.getUriForFile(getContext(), installed.packageName + ".fileprovider", apk);
                            Intent intent = new Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive");
                            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                            getActivity().startActivity(intent);
                        }
                        call.resolve();
                    } catch (Exception error) { call.reject("Paigaldaja avamine ebaõnnestus", error); }
                    finally { busy.set(false); }
                });
            } catch (Exception error) {
                apk.delete();
                busy.set(false);
                call.reject("Uuendus ebaõnnestus: " + error.getMessage(), error);
            }
        }, "muhu-updater").start();
    }
}
