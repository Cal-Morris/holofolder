import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import type { ShouldStartLoadRequest } from 'react-native-webview/lib/WebViewTypes';

const APP_URL = 'https://holofolder.com/app';
const APP_HOSTS = new Set(['holofolder.com', 'app.holofolder.com']);
const BACKGROUND = '#07070a';

// The web app already adapts to an installed PWA through navigator.standalone (safe areas,
// edge swipe-back, no install prompts), so the shell presents itself the same way.
const BEFORE_LOAD = `
  try { Object.defineProperty(navigator, 'standalone', { value: true, configurable: true }); } catch (e) {}
  window.HoloFolderNative = { platform: 'ios' };
  true;
`;

/** A holofolder.com/app page: these stay in the webview, and Universal Links to them open here. */
function isAppPage(url: string) {
  try {
    const { protocol, hostname, pathname } = new URL(url);
    return protocol === 'https:' && APP_HOSTS.has(hostname) && (pathname === '/app' || pathname.startsWith('/app/'));
  } catch {
    return false;
  }
}

/** Everything else (marketing pages, eBay, Stripe) opens in Safari. */
function isAppUrl(url: string) {
  return url.startsWith('about:') || url.startsWith('blob:') || url.startsWith('data:') || isAppPage(url);
}

function openOutside(url: string) {
  Linking.openURL(url).catch(() => {});
}

export default function App() {
  const webView = useRef<WebView<object>>(null);
  // A Universal Link (a sign-in email, a share link) that launched the app opens that page instead of the binder.
  const [startUrl, setStartUrl] = useState<string | null>(null);

  useEffect(() => {
    Linking.getInitialURL()
      .then((url) => setStartUrl(url && isAppPage(url) ? url : APP_URL))
      .catch(() => setStartUrl(APP_URL));
    const subscription = Linking.addEventListener('url', ({ url }) => {
      if (isAppPage(url)) webView.current?.injectJavaScript(`location.assign(${JSON.stringify(url)}); true;`);
    });
    return () => subscription.remove();
  }, []);

  const onShouldStartLoadWithRequest = (request: ShouldStartLoadRequest) => {
    if (!request.isTopFrame || isAppUrl(request.url)) return true;
    openOutside(request.url);
    return false;
  };

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      {startUrl && (
        // Explicit generic: React 19.3's ref types can't infer this class component's props.
        <WebView<object>
          ref={webView}
          source={{ uri: startUrl }}
          style={styles.root}
          applicationNameForUserAgent="HoloFolderApp/1"
          injectedJavaScriptBeforeContentLoaded={BEFORE_LOAD}
          // Service workers (offline mode) only run in WKWebView for app-bound domains (Info.plist WKAppBoundDomains).
          limitsNavigationsToAppBoundDomains
          sharedCookiesEnabled
          contentInsetAdjustmentBehavior="never"
          allowsInlineMediaPlayback
          mediaCapturePermissionGrantType="grantIfSameHostElsePrompt"
          allowsLinkPreview={false}
          webviewDebuggingEnabled={__DEV__}
          onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
          onOpenWindow={(event) => openOutside(event.nativeEvent.targetUrl)}
          // iOS kills the web content process under memory pressure, which leaves a blank screen.
          onContentProcessDidTerminate={() => webView.current?.reload()}
          renderError={() => (
            <View style={styles.error}>
              <Text style={styles.errorTitle}>Can’t reach Holo Folder</Text>
              <Text style={styles.errorBody}>
                Connect to the internet once to set up the app. After that it works offline.
              </Text>
              <Pressable accessibilityRole="button" style={styles.retry} onPress={() => webView.current?.reload()}>
                <Text style={styles.retryLabel}>Try again</Text>
              </Pressable>
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BACKGROUND },
  error: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 32,
    backgroundColor: BACKGROUND,
  },
  errorTitle: { color: '#fff', fontSize: 20, fontWeight: '600' },
  errorBody: { color: '#a1a1aa', fontSize: 15, textAlign: 'center' },
  retry: { marginTop: 8, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12, backgroundColor: '#27272a' },
  retryLabel: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
