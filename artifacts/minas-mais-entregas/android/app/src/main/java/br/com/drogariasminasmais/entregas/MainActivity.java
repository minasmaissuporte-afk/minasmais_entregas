package br.com.drogariasminasmais.entregas;

import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.webkit.CookieManager;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        CookieManager.getInstance().setAcceptCookie(true);
        registerPlugin(CourierDeviceSetupPlugin.class);
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(Color.parseColor("#E20210"));
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            CookieManager.getInstance().setAcceptThirdPartyCookies(
                getBridge().getWebView(),
                true
            );
        }
    }
}
