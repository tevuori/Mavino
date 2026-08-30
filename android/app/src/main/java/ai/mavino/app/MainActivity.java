package stud.mavino.net;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Register local plugins before super.onCreate so they're available
        // to the bridge on first load.
        registerPlugin(ApkUpdaterPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
