package in.gpsoftware.mobile;

import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.net.Uri;

import androidx.core.content.FileProvider;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;

/**
 * फोटो + मेसेज थेट एका विशिष्ट नंबरच्या WhatsApp चॅटमध्ये उघडतो (share sheet न दाखवता).
 * JS: Capacitor.registerPlugin('WaSend').send({ phone, text, fileUri })
 */
@CapacitorPlugin(name = "WaSend")
public class WaSendPlugin extends Plugin {

    @PluginMethod
    public void send(PluginCall call) {
        String phone = call.getString("phone", "");
        String text = call.getString("text", "");
        String fileUri = call.getString("fileUri", "");
        String mime = call.getString("mime", "image/jpeg");
        if (mime == null || mime.isEmpty()) mime = "image/jpeg";

        if (phone == null) phone = "";
        phone = phone.replaceAll("\\D", "");
        if (phone.length() == 10) phone = "91" + phone;
        if (phone.isEmpty()) {
            call.reject("नंबर नाही");
            return;
        }
        if (text == null) text = "";

        try {
            Uri stream = null;
            if (fileUri != null && !fileUri.isEmpty()) {
                String path = Uri.parse(fileUri).getPath();
                File f = new File(path);
                stream = FileProvider.getUriForFile(
                        getContext(), getContext().getPackageName() + ".fileprovider", f);
            }

            String[] packages = new String[]{"com.whatsapp", "com.whatsapp.w4b"};
            boolean started = false;

            for (String pkg : packages) {
                Intent i = new Intent(Intent.ACTION_SEND);
                i.setPackage(pkg);
                // "jid" = त्या नंबरचा चॅट थेट उघडतो
                i.putExtra("jid", phone + "@s.whatsapp.net");
                i.putExtra(Intent.EXTRA_TEXT, text);
                if (stream != null) {
                    i.setType(mime);
                    i.putExtra(Intent.EXTRA_STREAM, stream);
                    i.setClipData(ClipData.newRawUri("", stream));
                    i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    try {
                        getContext().grantUriPermission(pkg, stream, Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    } catch (Exception ignored) {
                    }
                } else {
                    i.setType("text/plain");
                }
                try {
                    getActivity().startActivity(i);
                    started = true;
                    break;
                } catch (ActivityNotFoundException e) {
                    // हे WhatsApp नाही — पुढचे (Business) बघतो
                }
            }

            if (!started) {
                call.reject("WhatsApp सापडले नाही");
                return;
            }
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage() == null ? "WhatsApp उघडता आले नाही" : e.getMessage());
        }
    }

    /** "पहा" — त्या नंबरचा WhatsApp चॅट थेट उघडतो (मजकूर/फोटो न भरता). */
    @PluginMethod
    public void openChat(PluginCall call) {
        String phone = call.getString("phone", "");
        if (phone == null) phone = "";
        phone = phone.replaceAll("\\D", "");
        if (phone.length() == 10) phone = "91" + phone;
        if (phone.isEmpty()) {
            call.reject("नंबर नाही");
            return;
        }
        String[] packages = new String[]{"com.whatsapp", "com.whatsapp.w4b"};
        for (String pkg : packages) {
            try {
                Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse("https://wa.me/" + phone));
                i.setPackage(pkg);
                getActivity().startActivity(i);
                call.resolve();
                return;
            } catch (ActivityNotFoundException e) {
                // पुढचे (Business) बघतो
            } catch (Exception e) {
                call.reject(e.getMessage() == null ? "WhatsApp उघडता आले नाही" : e.getMessage());
                return;
            }
        }
        call.reject("WhatsApp सापडले नाही");
    }
}
