# GP Software — मोबाईल (Android App)

`gp-mobile.html` चे Android app रूप. Firebase login, पावती, चावी नंबर आणि Live यादी — सगळे आधीसारखेच चालते.
Firebase च्या फाईल्स app मध्येच bundle आहेत (CDN ची गरज नाही).

## APK मिळवण्याची सोपी पद्धत (Android Studio न घेता)

1. https://github.com वर free account बनवा आणि **New repository** करा (नाव उदा. `gp-mobile`).
2. या folder मधल्या **सगळ्या फाईल्स व folders** (`.github`, `www`, `assets`, `package.json`,
   `package-lock.json`, `capacitor.config.json`, `.gitignore`) repo मध्ये **Add file → Upload files** ने टाका.
   (`.github` folder दिसत नसेल तर तो थेट drag करा, किंवा File Manager मध्ये "hidden files" चालू करा.)
3. **Commit** केल्यावर वरती **Actions** tab उघडा — "Build Android APK" आपोआप सुरू होते (साधारण 5–8 मिनिटे).
4. Run हिरवा (✅) झाला की त्यावर क्लिक करा → खाली **Artifacts → GP-Software-APK** डाउनलोड करा.
5. zip उघडून `app-debug.apk` फोनवर पाठवा → उघडा → "Install unknown apps" ला परवानगी द्या → Install.

पुन्हा build करायचे असेल तर: **Actions → Build Android APK → Run workflow**.

## बदल कसे करायचे

App चा सगळा भाग `www/index.html` मध्ये आहे. ती फाईल बदलून GitHub वर पुन्हा upload करा —
नवीन APK आपोआप तयार होईल.

## अडचण आल्यास

- **लॉगिन/Firestore चालत नाही:** Google Cloud Console → APIs & Services → Credentials मध्ये
  या API key वर "HTTP referrer" restriction असेल तर `https://localhost/*` ला परवानगी द्या.
- हा debug-signed APK आहे — स्वतःच्या/ऑफिसच्या फोनवर install करण्यासाठी पुरेसा आहे.
  Play Store साठी release signing लागेल.
