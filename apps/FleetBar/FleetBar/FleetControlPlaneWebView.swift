import SwiftUI
import WebKit
import AppKit

struct FleetControlPlaneWebView: NSViewRepresentable {
    let url: URL
    let reloadToken: UUID
    @Binding var isLoading: Bool
    @Binding var errorMessage: String?

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    func makeNSView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.preferences.setValue(true, forKey: "developerExtrasEnabled")
        let embedMarker = WKUserScript(
            source: "window.__PORT_DADDY_EMBED = 'fleetbar';",
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        )
        configuration.userContentController.addUserScript(embedMarker)

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.customUserAgent = "PortDaddyFleetBar"
        webView.navigationDelegate = context.coordinator
        webView.setValue(false, forKey: "drawsBackground")
        webView.allowsBackForwardNavigationGestures = false
        webView.wantsLayer = true
        webView.layer?.backgroundColor = NSColor.clear.cgColor

        context.coordinator.bind(isLoading: $isLoading, errorMessage: $errorMessage)
        context.coordinator.lastURL = url.absoluteString
        context.coordinator.lastReloadToken = reloadToken

        webView.load(URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData))
        return webView
    }

    func updateNSView(_ webView: WKWebView, context: Context) {
        context.coordinator.bind(isLoading: $isLoading, errorMessage: $errorMessage)

        let nextURL = url.absoluteString
        let needsReload = context.coordinator.lastURL != nextURL || context.coordinator.lastReloadToken != reloadToken
        guard needsReload else { return }

        context.coordinator.lastURL = nextURL
        context.coordinator.lastReloadToken = reloadToken
        webView.load(URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData))
    }

    final class Coordinator: NSObject, WKNavigationDelegate {
        var lastURL: String?
        var lastReloadToken: UUID?
        private var isLoadingBinding: Binding<Bool>?
        private var errorBinding: Binding<String?>?

        func bind(isLoading: Binding<Bool>, errorMessage: Binding<String?>) {
            isLoadingBinding = isLoading
            errorBinding = errorMessage
        }

        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
            errorBinding?.wrappedValue = nil
            isLoadingBinding?.wrappedValue = true
        }

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping @MainActor @Sendable (WKNavigationActionPolicy) -> Void
        ) {
            guard let requestURL = navigationAction.request.url else {
                decisionHandler(.cancel)
                return
            }

            if let host = requestURL.host, ["localhost", "127.0.0.1"].contains(host) {
                decisionHandler(.allow)
                return
            }

            if navigationAction.navigationType == .linkActivated {
                NSWorkspace.shared.open(requestURL)
                decisionHandler(.cancel)
                return
            }

            decisionHandler(.allow)
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            errorBinding?.wrappedValue = nil
            isLoadingBinding?.wrappedValue = false
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            errorBinding?.wrappedValue = error.localizedDescription
            isLoadingBinding?.wrappedValue = false
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            errorBinding?.wrappedValue = error.localizedDescription
            isLoadingBinding?.wrappedValue = false
        }
    }
}
