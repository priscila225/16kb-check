package dev.example.fixture;

import android.app.Activity;
import android.view.KeyEvent;

public class OldActivity extends Activity {
    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            finish();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }
}
