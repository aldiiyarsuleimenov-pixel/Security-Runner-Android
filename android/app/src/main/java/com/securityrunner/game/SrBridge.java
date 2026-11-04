package com.securityrunner.game;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.webkit.JavascriptInterface;

import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/** Small bridge so the game can save a text file into the public Downloads folder (used for story export). */
public class SrBridge {
    private final Activity activity;

    SrBridge(Activity activity) {
        this.activity = activity;
    }

    /** Returns the saved file name, or an empty string if saving is not possible. */
    @JavascriptInterface
    public String saveTextFile(String name, String content) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            return "";
        }
        try {
            ContentResolver resolver = activity.getContentResolver();
            ContentValues values = new ContentValues();
            values.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
            // A generic type keeps Android from appending ".txt" to the file name.
            values.put(MediaStore.MediaColumns.MIME_TYPE, "application/octet-stream");
            values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
            Uri uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
            if (uri == null) {
                return "";
            }
            try (OutputStream out = resolver.openOutputStream(uri)) {
                if (out == null) {
                    return "";
                }
                out.write(content.getBytes(StandardCharsets.UTF_8));
            }
            return name;
        } catch (Exception e) {
            return "";
        }
    }
}
