#!/usr/bin/env python3
"""
`npx cap add android` नंतर चालवायचे:  python3 native/add_wa_plugin.py
  → WaSendPlugin जोडतो आणि MainActivity मध्ये register करतो.
`python3 native/add_wa_plugin.py --remove`
  → (build अयशस्वी झाल्यास) plugin काढून MainActivity पूर्ववत करतो.
"""
import sys, re, shutil
from pathlib import Path

root = Path(__file__).resolve().parent.parent
java_root = root / 'android' / 'app' / 'src' / 'main' / 'java'
mains = list(java_root.rglob('MainActivity.java'))
if not mains:
    print('MainActivity.java सापडली नाही'); sys.exit(1)
main = mains[0]
bak = main.with_suffix('.java.bak')
plugin_dst = main.parent / 'WaSendPlugin.java'

res_values = root / 'android' / 'app' / 'src' / 'main' / 'res' / 'values'
colors_dst = res_values / 'colors.xml'
COLORS = '''<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="colorPrimary">#0B3C78</color>
    <color name="colorPrimaryDark">#072A55</color>
    <color name="colorAccent">#F59E0B</color>
</resources>
'''

if '--remove' in sys.argv:
    if colors_dst.exists() and 'GPTHEME' in colors_dst.read_text(encoding='utf-8'): colors_dst.unlink()
    if plugin_dst.exists(): plugin_dst.unlink()
    if bak.exists():
        shutil.copyfile(bak, main)
    print('plugin काढला'); sys.exit(0)

src = main.read_text(encoding='utf-8')
pkg = re.search(r'^package\s+([\w.]+);', src, re.M).group(1)

shutil.copyfile(main, bak)

plugin = (root / 'native' / 'WaSendPlugin.java').read_text(encoding='utf-8')
plugin = re.sub(r'^package\s+[\w.]+;', 'package ' + pkg + ';', plugin, count=1, flags=re.M)
plugin_dst.write_text(plugin, encoding='utf-8')

old = 'public class MainActivity extends BridgeActivity {}'
assert old in src, 'MainActivity चा आकार अपेक्षेप्रमाणे नाही'
new = '''public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(WaSendPlugin.class);
        super.onCreate(savedInstanceState);
    }
}'''
main.write_text(src.replace(old, new), encoding='utf-8')
# ब्रँड रंग (स्टेटस बार इ.) — फाइल आधीपासून असेल तर हात लावत नाही
try:
    if not colors_dst.exists():
        res_values.mkdir(parents=True, exist_ok=True)
        colors_dst.write_text(COLORS.replace('<resources>', '<resources>\n    <!-- GPTHEME -->'), encoding='utf-8')
        print('ब्रँड रंग जोडले:', colors_dst)
except Exception as e:
    print('रंग जोडता आले नाहीत (दुर्लक्ष):', e)
print('WaSend plugin जोडला:', plugin_dst)
