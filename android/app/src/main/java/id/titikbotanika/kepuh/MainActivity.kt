package id.titikbotanika.kepuh

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout

/**
 * Pembungkus aplikasi web Catatan Sembada Kepuh.
 * Semua tampilan dan logika ada di aplikasi web (GitHub Pages), jadi perbaikan
 * cukup dilakukan di web dan langsung sampai ke HP tanpa memasang ulang APK.
 */
class MainActivity : Activity() {

    private lateinit var web: WebView
    private lateinit var akar: FrameLayout

    private val alamat = "https://papaaikidil.github.io/catatan-sembada-kepuh/"
    private val hostAplikasi = "papaaikidil.github.io"
    private val warnaAwal = "#1B4331"

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        akar = FrameLayout(this)
        akar.setBackgroundColor(Color.parseColor(warnaAwal))
        // Jaga supaya isi tidak tertutup bilah status, bilah navigasi, atau keyboard.
        akar.setOnApplyWindowInsetsListener { v, insets ->
            if (Build.VERSION.SDK_INT >= 30) {
                val b = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.ime())
                v.setPadding(b.left, b.top, b.right, b.bottom)
            } else {
                @Suppress("DEPRECATION")
                v.setPadding(insets.systemWindowInsetLeft, insets.systemWindowInsetTop,
                    insets.systemWindowInsetRight, insets.systemWindowInsetBottom)
            }
            insets
        }

        web = WebView(this)
        web.setBackgroundColor(Color.parseColor("#F5F6F3"))
        akar.addView(web, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        setContentView(akar)

        with(web.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            @Suppress("DEPRECATION")
            databaseEnabled = true
            cacheMode = WebSettings.LOAD_DEFAULT
            setSupportZoom(false)
            builtInZoomControls = false
            textZoom = 100
            userAgentString = "$userAgentString CatatanSembadaKepuhApp"
        }

        // Aplikasi web memberi tahu warna kepala yang dipilih di menu Tampilan,
        // supaya bilah status HP ikut berwarna sama.
        web.addJavascriptInterface(JembatanTampilan(), "KepuhAndroid")

        web.webChromeClient = WebChromeClient()   // agar dialog konfirmasi bisa muncul
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val url = request.url
                if (url.host == hostAplikasi) return false
                return try {
                    startActivity(Intent(Intent.ACTION_VIEW, url))
                    true
                } catch (e: Exception) {
                    true
                }
            }

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (request.isForMainFrame) {
                    view.loadDataWithBaseURL(alamat, halamanTanpaSinyal(), "text/html", "utf-8", null)
                }
            }
        }

        if (savedInstanceState != null) {
            web.restoreState(savedInstanceState)
        } else {
            web.loadUrl(alamat)
        }
    }

    inner class JembatanTampilan {
        @JavascriptInterface
        fun warnaBilah(hex: String) {
            val warna = try { Color.parseColor(hex) } catch (e: Exception) { return }
            runOnUiThread { aturWarnaBilah(warna) }
        }
    }

    @Suppress("DEPRECATION")
    private fun aturWarnaBilah(warna: Int) {
        akar.setBackgroundColor(warna)
        // Ikon bilah status gelap kalau warna kepala terang, putih kalau gelap.
        val r = Color.red(warna) / 255.0
        val g = Color.green(warna) / 255.0
        val b = Color.blue(warna) / 255.0
        val terang = 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.6
        if (Build.VERSION.SDK_INT >= 30) {
            val pengatur = window.insetsController ?: return
            val bendera = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS
            pengatur.setSystemBarsAppearance(if (terang) bendera else 0, bendera)
        } else {
            val f = window.decorView.systemUiVisibility
            window.decorView.systemUiVisibility =
                if (terang) f or View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR else f and View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR.inv()
        }
    }

    private fun halamanTanpaSinyal(): String = """
        <!doctype html><html lang="id"><head><meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body{font-family:system-ui,sans-serif;background:#F5F6F3;color:#1C2420;margin:0;display:flex;
               min-height:100vh;align-items:center;justify-content:center;text-align:center;padding:24px;box-sizing:border-box}
          a{display:inline-block;margin-top:20px;background:#2D7C5B;color:#fff;text-decoration:none;font-weight:700;
            padding:14px 24px;border-radius:12px}
          p{color:#5B6660}
        </style></head><body><div>
          <h2>Belum ada sinyal</h2>
          <p>Catatan Sembada Kepuh perlu internet sekali saat pertama dibuka.<br>Setelah itu bisa dipakai tanpa sinyal.</p>
          <a href="$alamat">Coba lagi</a>
        </div></body></html>
    """.trimIndent()

    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        if (keyCode == KeyEvent.KEYCODE_BACK && web.canGoBack()) {
            web.goBack()
            return true
        }
        return super.onKeyDown(keyCode, event)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    override fun onPause() {
        web.onPause()
        super.onPause()
    }

    override fun onResume() {
        super.onResume()
        web.onResume()
    }
}
